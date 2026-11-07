begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'w-super@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000c2', 'w-admin@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000c3', 'w-awa@users.calebasse.invalid');
insert into public.profiles (id, first_name, last_name, phone, global_role, language, payout_phone) values
  ('00000000-0000-0000-0000-0000000000c1', 'Super', 'Admin', '770000901', 'super_admin', 'fr', null),
  ('00000000-0000-0000-0000-0000000000c2', 'Moussa', 'Diop', '770000902', 'admin', 'fr', '770000902'),
  ('00000000-0000-0000-0000-0000000000c3', 'Awa', 'Fall', '770000903', 'user', 'wo', '770000903');
insert into public.communities (id, name) values ('00000000-0000-0000-0000-0000000000cc', 'Test wolof');
insert into public.community_admins (community_id, admin_id)
values ('00000000-0000-0000-0000-0000000000cc', '00000000-0000-0000-0000-0000000000c2');

create temp table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated, service_role;
create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p)::text, true);
$$;
create function pg_temp.id(p text) returns uuid language sql as $$
  select id from ids where name = p;
$$;

-- 200 000 FCFA par mois, 2 parts : cagnotte de 400 000 (au-dessus du seuil de 300 000).
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
insert into ids select 'g', public.group_create(jsonb_build_object(
  'name', 'Grosse tontine', 'contributionAmount', 200000, 'frequency', 'monthly', 'turnLength', 1,
  'maxMembers', 2, 'paymentDueDay', 5, 'startDate', (current_date + 1)::text));
select public.membership_add_by_phone(pg_temp.id('g'), '770000903', 1);
select public.order_set(pg_temp.id('g'), array(
  select m.id from public.memberships m where m.group_id = pg_temp.id('g') order by m.user_id));
select public.group_start(pg_temp.id('g'));
insert into ids select 'r' || number, id from public.rounds where group_id = pg_temp.id('g');
select public.payment_record_cash(pg_temp.id('r1'), u)
from unnest(array['00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c3']::uuid[]) u;
reset role;

-- 1. Notification dans la langue du membre.
select is(
  (select body from public.notifications
   where user_id = '00000000-0000-0000-0000-0000000000c3' and title = 'Paiement en espèces enregistré'),
  'Jërëjëf Awa ! Sa fay bu 200 000 FCFA ci « Grosse tontine » agsi na. (tour 1, espèces)',
  'the payment notification uses the Wolof template');

-- 2. Seconde validation : l'admin demande, le super admin valide.
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select is(public.round_payout(pg_temp.id('r1')), 'pending_approval',
  'a big pot needs the super admin: the admin only requests');
select is((select status::text from public.rounds where id = pg_temp.id('r1')), 'ready_for_payout',
  'the pot is not paid out yet');
select is(public.round_payout(pg_temp.id('r1')), 'pending_approval', 'asking twice changes nothing');
reset role;
select is(
  (select count(*)::int from public.notifications
   where user_id = '00000000-0000-0000-0000-0000000000c1' and type = 'payout_approval'),
  1, 'the super admin is asked once');
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select is(public.round_payout(pg_temp.id('r1')), 'paid', 'the super admin validates the payout');

-- Envoi automatique (préparé) : droits de l'admin, montant et numéro, puis envoi noté.
reset role;
set local role service_role;
select throws_ok(
  $$select public.svc_payout_transfer_prepare('00000000-0000-0000-0000-0000000000c3', pg_temp.id('r1'), '00000000-0000-0000-0000-0000000000c2')$$,
  '42501', null, 'a member cannot send a pot');
select is(
  (public.svc_payout_transfer_prepare('00000000-0000-0000-0000-0000000000c2', pg_temp.id('r1'),
    '00000000-0000-0000-0000-0000000000c2') ->> 'amount')::int,
  400000, 'the transfer amount is the validated pot');
select public.svc_payout_transfer_done('00000000-0000-0000-0000-0000000000c2', pg_temp.id('r1'),
  '00000000-0000-0000-0000-0000000000c2', 'wave', 'PAYTECH-TR-1');
select is((select sent_ref from public.round_beneficiaries where round_id = pg_temp.id('r1')),
  'PAYTECH-TR-1', 'a successful transfer is recorded like a manual one');
reset role;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');

-- Modèles wolof : modifiables par le super admin seulement.
select lives_ok($$select public.settings_update_templates('wo', jsonb_build_object(
  'reminder', 'Salaam {prenom}, fayal {montant} ci « {groupe} ».',
  'late', 'Salaam {prenom}, dafa yéex : {montant}.',
  'payment', 'Jërëjëf {prenom}, {montant} agsi na.',
  'payout', 'Xibaar bu baax {prenom} : {montant} yónnee nañu la ko.'))$$,
  'the super admin edits the Wolof templates');
select is((public.settings_get() -> 'templatesWo' ->> 'payment'), 'Jërëjëf {prenom}, {montant} agsi na.',
  'the Wolof templates are returned');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select throws_ok($$select public.settings_update_templates('fr', '{}')$$, '42501', null,
  'an admin cannot edit the templates');
reset role;

-- 3. Dette remboursée en ligne.
insert into public.debts (group_id, round_id, user_id, amount, penalty_amount)
values (pg_temp.id('g'), pg_temp.id('r1'), '00000000-0000-0000-0000-0000000000c3', 1000, 500);
insert into ids select 'd', id from public.debts where round_id = pg_temp.id('r1');
set local role service_role;
create temp table prep (j jsonb) on commit drop;
grant all on prep to service_role;
insert into prep select public.svc_debt_payment_prepare('00000000-0000-0000-0000-0000000000c3',
  pg_temp.id('d'), 'wave');
select is((select (j ->> 'amount')::int from prep), 1500, 'the online repayment is the whole debt');
select is(public.svc_payment_confirm((select (j ->> 'paymentId')::uuid from prep),
  (select (j ->> 'total')::int from prep), 'DEBT-REF-1', '770000903'), 'ok',
  'PayTech confirms the repayment');
reset role;
select is((select status::text || '/' || settled_via::text from public.debts where id = pg_temp.id('d')),
  'settled/online', 'the debt is settled online');
set local role service_role;
select throws_ok(
  $$select public.svc_debt_payment_prepare('00000000-0000-0000-0000-0000000000c3', pg_temp.id('d'), 'wave')$$,
  '23505', null, 'a settled debt cannot be paid again');
reset role;

select * from finish();
rollback;
