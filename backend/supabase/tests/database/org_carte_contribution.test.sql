begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c7', 'card-super@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000c8', 'card-admin@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000c9', 'card-member@users.calebasse.invalid');
insert into public.profiles (id, first_name, last_name, phone, global_role) values
  ('00000000-0000-0000-0000-0000000000c7', 'Super', 'Admin', '770000601', 'super_admin'),
  ('00000000-0000-0000-0000-0000000000c8', 'Awa', 'Générale', '770000602', 'user'),
  ('00000000-0000-0000-0000-0000000000c9', 'Fatou', 'Militante', '770000603', 'user');

create temp table ids (k text primary key, id uuid, t text) on commit drop;
grant all on ids to authenticated, anon;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c7"}', true);
insert into ids (k, id) select 'org', public.organization_save(null, 'Organisation carte', 'OCA', 'oca',
  '#1A5BA8', null);
select public.organization_set_role((select id from ids where k = 'org'), '770000602', 'org_admin', true);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c9"}', true);
select is(public.my_member_card('oca'), null, 'no card before the membership is validated');

reset role;
select private.ensure_active_org_member((select id from ids where k = 'org'),
  '00000000-0000-0000-0000-0000000000c9');
set local role authenticated;
select is(public.my_member_card('oca') ->> 'memberNumber', 'OCA-000002',
  'an active member gets her card with her number');
insert into ids (k, t) select 'token', public.my_member_card('oca') ->> 'token';

set local role anon;
select is((public.org_card_verify((select t from ids where k = 'token')) ->> 'valid')::boolean, true,
  'anyone scanning the QR code sees that the card is valid');
select is(public.org_card_verify('00000000000000000000000000000000'), null,
  'an unknown QR code is not recognised');

set local role authenticated;
select public.my_member_card_renew('oca');
set local role anon;
select is(public.org_card_verify((select t from ids where k = 'token')), null,
  'after a renewal the old QR code is no longer valid');

reset role;
update public.organization_members set status = 'suspended'
where user_id = '00000000-0000-0000-0000-0000000000c9';
insert into ids (k, t) select 'token2', card_token from public.organization_members
where user_id = '00000000-0000-0000-0000-0000000000c9';
set local role anon;
select is((public.org_card_verify((select t from ids where k = 'token2')) ->> 'valid')::boolean, false,
  'a suspended member''s card shows as not valid');

reset role;
update public.organization_members set status = 'active'
where user_id = '00000000-0000-0000-0000-0000000000c9';

-- Contribution libre au fonds commun.
insert into ids (k, id) select 'intent', (public.svc_org_contribution_prepare(
  '00000000-0000-0000-0000-0000000000c9', 'oca', 3000, 'orange_money') ->> 'intentId')::uuid;
select public.svc_org_payment_set_token((select id from ids where k = 'intent'), 'TOK-C1');
select throws_ok(
  $$ select public.svc_org_contribution_prepare('00000000-0000-0000-0000-0000000000c9', 'oca', 50, 'wave') $$,
  '22023', null, 'a contribution below 100 FCFA is refused');
select is(
  public.svc_org_payment_confirm((select id from ids where k = 'intent'),
    (select amount + service_fee from public.org_payment_intents where id = (select id from ids where k = 'intent')),
    'TOK-C1', null),
  'ok', 'the confirmed contribution is recorded');
select is(private.account_balance((select id from ids where k = 'org'), 'common')::int, 3000,
  'the contribution goes to the common fund');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c9"}', true);
set local role authenticated;
select is((public.my_org_contributions('oca') -> 0 ->> 'amount')::int, 3000,
  'the member sees her contribution in her history');
reset role;

-- Mode test PayTech : le paiement réussit chez PayTech mais n'est jamais comptabilisé.
insert into ids (k, id) select 'intent_test', (public.svc_org_contribution_prepare(
  '00000000-0000-0000-0000-0000000000c9', 'oca', 5000, 'wave') ->> 'intentId')::uuid;
select public.svc_org_payment_set_token((select id from ids where k = 'intent_test'), 'TOK-T1', true);
select is(
  public.svc_org_payment_confirm((select id from ids where k = 'intent_test'),
    (select amount + service_fee from public.org_payment_intents where id = (select id from ids where k = 'intent_test')),
    'TOK-T1', null),
  'test', 'a PayTech test-mode payment is acknowledged as a test');
select is(private.account_balance((select id from ids where k = 'org'), 'common')::int, 3000,
  'a test-mode payment is never counted');

-- Carte seulement après le paiement des frais d'adhésion.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c8"}', true);
insert into ids (k, id) select 'struct', public.structure_save((select id from ids where k = 'org'),
  null, 'Mouvement carte', 'mouvement', null, null, null, null);
reset role;
insert into public.structure_members (structure_id, user_id, status, requested_at, decided_at)
values ((select id from ids where k = 'struct'), '00000000-0000-0000-0000-0000000000c9', 'active',
  now(), now());
set local role authenticated;
insert into ids (k, id) select 'adh', public.org_fund_save((select id from ids where k = 'struct'),
  null, 'Frais d''adhésion', 'adhesion', 5000, 'once', current_date, 5, null);
reset role;
insert into ids (k, t) select 'token3', card_token from public.organization_members
where user_id = '00000000-0000-0000-0000-0000000000c9';
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c9"}', true);
select is(public.my_member_card('oca'), '{"pending": "adhesion", "amountDue": 5000}'::jsonb,
  'no card while the membership fee is unpaid');
set local role anon;
select is((public.org_card_verify((select t from ids where k = 'token3')) ->> 'valid')::boolean, false,
  'the QR code shows as not valid while the membership fee is unpaid');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c8"}', true);
select public.org_payment_record((select id from ids where k = 'adh'),
  '00000000-0000-0000-0000-0000000000c9', 2000, 'cash', null);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c9"}', true);
select is((public.my_member_card('oca') ->> 'amountDue')::int, 3000,
  'a partial payment leaves the card unavailable, with what is left to pay');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c8"}', true);
select public.org_payment_record((select id from ids where k = 'adh'),
  '00000000-0000-0000-0000-0000000000c9', 3000, 'cash', null);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c9"}', true);
select is(public.my_member_card('oca') ->> 'memberNumber', 'OCA-000002',
  'the card is available once the membership fee is paid');
set local role anon;
select is((public.org_card_verify((select t from ids where k = 'token3')) ->> 'valid')::boolean, true,
  'the QR code is valid once the membership fee is paid');

-- L'adhésion se paie une fois : une autre structure avec ses frais ne reprend pas la carte.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c8"}', true);
insert into ids (k, id) select 'struct2', public.structure_save((select id from ids where k = 'org'),
  null, 'Mouvement des jeunes', 'mouvement', null, null, null, null);
reset role;
insert into public.structure_members (structure_id, user_id, status, requested_at, decided_at)
values ((select id from ids where k = 'struct2'), '00000000-0000-0000-0000-0000000000c9', 'active',
  now(), now());
set local role authenticated;
insert into ids (k, id) select 'adh2', public.org_fund_save((select id from ids where k = 'struct2'),
  null, 'Adhésion jeunes', 'adhesion', 2000, 'once', current_date, 5, null);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c9"}', true);
select is(public.my_member_card('oca') ->> 'memberNumber', 'OCA-000002',
  'once the membership fee is paid, the card stays even with another structure''s fee');
select is(public.my_member_card('oca') -> 'structures', '["Mouvement carte"]'::jsonb,
  'a structure whose membership fee is unpaid is not on the card yet');
select is(public.my_member_card('oca') -> 'pendingStructures',
  '[{"name": "Mouvement des jeunes", "amountDue": 2000}]'::jsonb,
  'the card lists the structure waiting for its membership fee, with what is left to pay');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c8"}', true);
select public.org_payment_record((select id from ids where k = 'adh2'),
  '00000000-0000-0000-0000-0000000000c9', 2000, 'cash', null);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c9"}', true);
select is(jsonb_array_length(public.my_member_card('oca') -> 'structures'), 2,
  'once its membership fee is paid, the structure appears on the card');
select is(public.my_member_card('oca') -> 'pendingStructures', '[]'::jsonb,
  'nothing is left waiting');


-- Journal d'audit : les gestes des membres y figurent aussi.
reset role;
select is((select count(*)::int from public.audit_log
  where actor_id = '00000000-0000-0000-0000-0000000000c9' and action = 'online_payment'), 1,
  'a member''s online payment is in the audit log (the test-mode one is not)');
select is((select count(*)::int from public.audit_log
  where actor_id = '00000000-0000-0000-0000-0000000000c9' and action = 'join_requested'), 0,
  'a member added by an admin is not logged as a request of her own');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c8"}', true);
insert into ids (k, id) select 'struct3', public.structure_save((select id from ids where k = 'org'),
  null, 'Mouvement des cadres', 'mouvement', null, null, null, null);
reset role;
insert into ids (k, t) select 'code3', invite_code from public.org_structures
where id = (select id from ids where k = 'struct3');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c9"}', true);
select public.structure_join((select t from ids where k = 'code3'), 'Dakar', 'Dakar', null, null);
reset role;
select is((select summary from public.audit_log
  where actor_id = '00000000-0000-0000-0000-0000000000c9' and action = 'join_requested'),
  'a demandé à rejoindre « Mouvement des cadres » (OCA)',
  'a member''s own request to join a structure is in the audit log');

select is((select summary from public.audit_log
  where actor_id = '00000000-0000-0000-0000-0000000000c9' and action = 'member_updated'),
  'a remplacé sa carte de membre (OCA)',
  'a member replacing her card is in the audit log');

select * from finish();
rollback;
