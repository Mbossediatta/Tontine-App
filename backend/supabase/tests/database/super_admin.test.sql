begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 's-super@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000f2', 's-admin@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000f3', 's-awa@users.calebasse.invalid');
insert into public.profiles (id, first_name, last_name, phone, global_role, payout_phone) values
  ('00000000-0000-0000-0000-0000000000f1', 'Super', 'Admin', '770000981', 'super_admin', null),
  ('00000000-0000-0000-0000-0000000000f2', 'Moussa', 'Diop', '770000982', 'admin', '770000982'),
  ('00000000-0000-0000-0000-0000000000f3', 'Awa', 'Fall', '770000983', 'user', '770000983');
insert into public.communities (id, name) values ('00000000-0000-0000-0000-0000000000fc', 'Test super admin');
insert into public.community_admins (community_id, admin_id)
values ('00000000-0000-0000-0000-0000000000fc', '00000000-0000-0000-0000-0000000000f2');

create temp table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated, service_role;
create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p)::text, true);
$$;

set local role authenticated;

-- --- Paramètres --------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select throws_ok($$select public.settings_get()$$, '42501', null, 'an admin cannot read settings');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select is(public.settings_get() -> 'templates' ->> 'payment' like '%{prenom}%', true,
  'settings expose the French templates');
select throws_ok(
  $$select public.settings_update('rules', '{"graceDays":40,"defaultLatePenalty":500,"minContribution":500,"maxContribution":500000,"maxMembers":50}')$$,
  '22023', null, 'grace days are limited');
select lives_ok(
  $$select public.settings_update('payment', '{"provider":"PayTech","publicKey":"pk_test_123","feePercent":2,"mode":"test","secretKeyHint":"•••• faux"}', 'sk_test_secret_9f3a')$$,
  'super admin saves the PayTech keys');
select is(public.settings_get() -> 'payment' ->> 'secretKeyHint', '•••• 9f3a',
  'only a hint of the secret is shown');
select is(public.settings_get() -> 'payment' ->> 'feePercent', '2', 'fee percent saved');
select throws_ok(
  $$select public.settings_update('sms', '{"provider":"Orange","senderName":"CALEBASSE","costPerSms":25}', 'cle-orange-123')$$,
  '22023', null, 'the Orange key is not set from the app');
select lives_ok(
  $$select public.settings_update('templates', '{"reminder":"Bonjour {prenom}, payez {montant}.","late":"Bonjour {prenom}, vous êtes en retard.","payment":"Merci {prenom} pour {montant}.","payout":"Bravo {prenom}, cagnotte versée."}')$$,
  'templates saved');

reset role;
select is((select templates -> 'wo' is not null from public.platform_settings), true,
  'the Wolof templates are kept');
set local role service_role;
select is(public.svc_paytech_keys() ->> 'apiSecret', 'sk_test_secret_9f3a',
  'the Edge Functions read the secret from the vault');
reset role;
set local role authenticated;
select throws_ok($$select public.svc_paytech_keys()$$, '42501', null,
  'the browser cannot read the PayTech secret');

-- --- Versements et rémunération -------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
insert into ids select 'g', public.group_create(jsonb_build_object(
  'name', 'Tontine super admin', 'contributionAmount', 1000, 'frequency', 'daily', 'turnLength', 2,
  'maxMembers', 2, 'paymentDueDay', 1, 'startDate', current_date::text,
  'collectMembershipFee', true, 'membershipFeeAmount', 500, 'reserveFinalTurn', false));
select public.membership_add_by_phone((select id from ids where name = 'g'), '770000983', 1);
select public.order_draw((select id from ids where name = 'g'));
select public.group_start((select id from ids where name = 'g'));
reset role;
insert into ids select 'r', id from public.rounds where group_id = (select id from ids where name = 'g') and number = 1;
set local role authenticated;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select lives_ok($$select public.payout_block((select id from ids where name = 'r'), 'Vérification du relevé')$$,
  'super admin blocks a payout');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select public.payment_record_cash((select id from ids where name = 'r'), '00000000-0000-0000-0000-0000000000f2');
select public.payment_record_cash((select id from ids where name = 'r'), '00000000-0000-0000-0000-0000000000f3');
select throws_ok($$select public.round_payout((select id from ids where name = 'r'))$$,
  '22023', null, 'a blocked payout cannot be validated');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select lives_ok($$select public.payout_unblock((select id from ids where name = 'r'))$$,
  'super admin unblocks the payout');
select throws_ok(
  $$select public.admin_compensate((select id from ids where name = 'g'), 5000, 'Merci')$$,
  '22023', null, 'compensation is limited to the group income (2 membership fees = 1 000)');
select lives_ok(
  $$select public.admin_compensate((select id from ids where name = 'g'), 600, 'Suivi du groupe')$$,
  'super admin pays the group admin');

-- --- Litiges ouverts automatiquement par une notification anormale ----------------------
reset role;
update public.rounds set status = 'open' where group_id = (select id from ids where name = 'g') and number = 2;
set local role service_role;
insert into ids select 'p', (public.svc_payment_prepare(
  '00000000-0000-0000-0000-0000000000f3',
  (select id from public.rounds where group_id = (select id from ids where name = 'g') and number = 2),
  'wave') ->> 'paymentId')::uuid;
set local role service_role;
select is(public.svc_payment_confirm((select id from ids where name = 'p'), 999, 'TOK-X', null),
  'mismatch', 'a wrong amount is refused');
reset role;
select is(
  (select kind::text || '/' || status::text from public.disputes where payment_id = (select id from ids where name = 'p')),
  'wrong_amount/open', 'a dispute is opened automatically');
insert into ids select 'd', id from public.disputes where payment_id = (select id from ids where name = 'p');

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select lives_ok($$select public.dispute_take((select id from ids where name = 'd'))$$, 'super admin takes the dispute');
select throws_ok($$select public.dispute_refund((select id from ids where name = 'd'), 5000, '')$$,
  '22023', null, 'refund cannot exceed the disputed amount');
select lives_ok($$select public.dispute_refund((select id from ids where name = 'd'), 999, 'Remboursé par Wave')$$,
  'super admin validates the refund');
select throws_ok($$select public.dispute_reject((select id from ids where name = 'd'), 'Trop tard')$$,
  '22023', 'Ce litige est déjà clôturé.', 'a closed dispute does not move');

-- --- Annonces ------------------------------------------------------------------------
reset role;
set local role service_role;
select is(
  jsonb_array_length(public.svc_announcement('00000000-0000-0000-0000-0000000000f1', 'group',
    (select id from ids where name = 'g'), 'Réunion', 'Réunion samedi à 10 h.')),
  2, 'a group announcement reaches its two members');
select throws_ok(
  $$select public.svc_announcement('00000000-0000-0000-0000-0000000000f2', 'all', null, 'Titre', 'Message')$$,
  '42501', null, 'only the super admin sends announcements');

select * from finish();
rollback;
