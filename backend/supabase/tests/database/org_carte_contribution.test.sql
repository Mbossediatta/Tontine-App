begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

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

select * from finish();
rollback;
