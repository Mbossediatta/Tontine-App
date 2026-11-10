begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'exp-super@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000a2', 'exp-admin@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000a3', 'exp-finance@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000a5', 'exp-validator@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000a6', 'exp-treasurer@users.calebasse.invalid');
insert into public.profiles (id, first_name, last_name, phone, global_role) values
  ('00000000-0000-0000-0000-0000000000a1', 'Super', 'Admin', '770000701', 'super_admin'),
  ('00000000-0000-0000-0000-0000000000a2', 'Awa', 'Générale', '770000702', 'user'),
  ('00000000-0000-0000-0000-0000000000a3', 'Ousmane', 'Financier', '770000703', 'user'),
  ('00000000-0000-0000-0000-0000000000a5', 'Ibou', 'Validateur', '770000705', 'user'),
  ('00000000-0000-0000-0000-0000000000a6', 'Modou', 'Trésorier', '770000706', 'user');

create temp table ids (k text primary key, id uuid) on commit drop;
grant all on ids to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1"}', true);
insert into ids select 'org', public.organization_save(null, 'Organisation dépenses', 'ODP', 'odp',
  '#1A5BA8', null);
select public.organization_set_role((select id from ids where k = 'org'), '770000702', 'org_admin', true);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2"}', true);
select public.organization_set_role((select id from ids where k = 'org'), '770000703', 'finance_admin', true);
select public.organization_set_role((select id from ids where k = 'org'), '770000705', 'validator', true);
insert into ids select 'femmes', public.structure_save((select id from ids where k = 'org'), null,
  'Mouvement des femmes', 'mouvement', null, null, null, null);
select public.structure_set_role((select id from ids where k = 'femmes'), '770000706', 'tresorier', true);

-- 100 000 FCFA dans la caisse de la structure.
reset role;
select private.entry_move(private.entry_create((select id from ids where k = 'org'), 'don', 100000,
  'Don de départ', jsonb_build_object('structure_id', (select id from ids where k = 'femmes'))),
  'treasury', null, 'structure', (select id from ids where k = 'femmes'), 100000);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a6"}', true);
insert into ids select 'exp', public.org_expense_submit('odp', 'structure',
  (select id from ids where k = 'femmes'), 'Location de salle', 'activite',
  'Réunion régionale du mouvement', 30000);
select is((public.org_expense_view((select id from ids where k = 'exp')) ->> 'status'), 'submitted',
  'the treasurer submits an expense request');
select throws_ok(
  format($$ select public.org_expense_verify(%L, true, 'ok') $$, (select id from ids where k = 'exp')),
  '42501', null, 'the requester cannot verify his own request');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3"}', true);
select lives_ok(
  format($$ select public.org_expense_verify(%L, true, 'Fonds disponibles') $$, (select id from ids where k = 'exp')),
  'the finance department checks the funds');
select throws_ok(
  format($$ select public.org_expense_decide(%L, 'approve', 30000, 'ok') $$, (select id from ids where k = 'exp')),
  '42501', null, 'the person who verified cannot decide');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a5"}', true);
select lives_ok(
  format($$ select public.org_expense_decide(%L, 'approve', 25000, 'Approuvée partiellement : devis moins cher') $$,
    (select id from ids where k = 'exp')),
  'the validation authority approves part of the amount');
select is((public.org_expense_view((select id from ids where k = 'exp')) ->> 'amountApproved')::int, 25000,
  'the approved amount is recorded');
reset role;
select is((select count(*)::int from public.org_entries where expense_id = (select id from ids where k = 'exp')),
  0, 'approved does not mean paid: no money has left the fund yet');
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a6"}', true);
select throws_ok(
  format($$ select public.org_expense_pay(%L, 30000, 'cash', null, null) $$, (select id from ids where k = 'exp')),
  null, null, 'more than the approved amount cannot be paid');
select lives_ok(
  format($$ select public.org_expense_pay(%L, 25000, 'cash', null, 'Payé au loueur') $$, (select id from ids where k = 'exp')),
  'the treasurer pays the approved amount');
reset role;
select is(private.account_balance((select id from ids where k = 'org'), 'structure',
  (select id from ids where k = 'femmes'))::int, 75000, 'the payment leaves the structure fund');
set local role authenticated;
reset role;
insert into public.org_documents (organization_id, path, name, mime, size, category, entity_type, entity_id)
values ((select id from ids where k = 'org'), 'test/facture.pdf', 'Facture', 'application/pdf', 1000,
  'facture', 'expense', (select id from ids where k = 'exp'));
set local role authenticated;
select lives_ok(
  format($$ select public.org_expense_justify(%L, 25000, 'Facture jointe') $$, (select id from ids where k = 'exp')),
  'the treasurer justifies the expense');
select is((public.org_expense_view((select id from ids where k = 'exp')) ->> 'status'), 'closed',
  'a fully justified expense is closed');

select * from finish();
rollback;
