begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'rap-super@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000a2', 'rap-admin@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000a3', 'rap-finance@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000a4', 'rap-member@users.calebasse.invalid');
insert into public.profiles (id, first_name, last_name, phone, global_role) values
  ('00000000-0000-0000-0000-0000000000a1', 'Super', 'Admin', '770000971', 'super_admin'),
  ('00000000-0000-0000-0000-0000000000a2', 'Awa', 'Générale', '770000972', 'user'),
  ('00000000-0000-0000-0000-0000000000a3', 'Rama', 'Finances', '770000973', 'user'),
  ('00000000-0000-0000-0000-0000000000a4', 'Fatou', 'Militante', '770000974', 'user');

create temp table ids (k text primary key, id uuid) on commit drop;
grant all on ids to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1"}', true);
insert into ids select 'org', public.organization_save(null, 'Organisation rapprochement', 'ORA', 'ora',
  '#1A5BA8', null);
select public.organization_set_role((select id from ids where k = 'org'), '770000972', 'org_admin', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2"}', true);
select public.organization_set_role((select id from ids where k = 'org'), '770000973', 'finance_admin', true);
insert into ids select 'str', public.structure_save((select id from ids where k = 'org'), null,
  'Commune test', 'commune', null, null, null, null);
insert into ids select 'fund', public.org_fund_save((select id from ids where k = 'str'), null,
  'Cotisation', 'cotisation', 2000, 'monthly', current_date, 5, null);
reset role;
insert into public.structure_members (structure_id, user_id, status, decided_at)
values ((select id from ids where k = 'str'), '00000000-0000-0000-0000-0000000000a4', 'active', now());
-- Deux paiements : 2 000 FCFA en espèces, 2 000 FCFA par Wave.
select private.org_payment_apply((select id from ids where k = 'fund'),
  '00000000-0000-0000-0000-0000000000a4', 2000, 'cash', null, '00000000-0000-0000-0000-0000000000a3');
select private.org_payment_apply((select id from ids where k = 'fund'),
  '00000000-0000-0000-0000-0000000000a4', 2000, 'wave', 'WV-1', null);

-- Le responsable financier déclare la caisse en espèces de la structure.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3"}', true);
insert into ids select 'cash', (public.org_money_account_save('ora', null, 'Caisse Commune test', 'cash',
  (select id from ids where k = 'str'), null, current_date - 1, 500, true) ->> 'id')::uuid;
select is((public.org_money_accounts('ora') -> 'accounts' -> 0 ->> 'expected')::int, 2500,
  'expected cash = opening balance + cash received only (not the Wave payment)');

select throws_ok(format($$ select public.org_reconciliation_record(%L, current_date, 2400, null) $$,
  (select id from ids where k = 'cash')), '22023', null, 'a difference must be explained');
select lives_ok(format($$ select public.org_reconciliation_record(%L, current_date, 2400, 'Monnaie rendue en trop') $$,
  (select id from ids where k = 'cash')), 'an explained difference is recorded');
select is((public.org_money_accounts('ora') -> 'accounts' -> 0 -> 'last' ->> 'difference')::int, -100,
  'the difference is computed by the server');
select throws_ok(format($$ select public.org_reconciliation_record(%L, current_date + 1, 2500, null) $$,
  (select id from ids where k = 'cash')), '22023', null, 'a statement cannot be dated in the future');
select throws_ok(format(
  $$ select public.org_money_account_save('ora', %L, 'Caisse Commune test', 'cash', %L, null, current_date - 1, 900, true) $$,
  (select id from ids where k = 'cash'), (select id from ids where k = 'str')), '22023', null,
  'the opening balance of a reconciled account cannot change');

-- Un membre n'y a pas accès.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a4"}', true);
select throws_ok($$ select public.org_money_accounts('ora') $$, '42501', null,
  'a member does not see the accounts');
select throws_ok(format($$ select public.org_reconciliation_record(%L, current_date, 2500, null) $$,
  (select id from ids where k = 'cash')), '42501', null, 'a member cannot record a statement');
reset role;

-- Un rapprochement ne se modifie ni ne s'efface.
select throws_ok($$ update public.org_reconciliations set statement_balance = 2500 $$, null, null,
  'a recorded reconciliation cannot be changed');
select throws_ok($$ delete from public.org_reconciliations $$, null, null,
  'a recorded reconciliation cannot be deleted');

select * from finish();
rollback;
