begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'fin-super@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000e2', 'fin-admin@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000e3', 'fin-finance@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000e4', 'fin-projects@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000e5', 'fin-validator@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000e6', 'fin-member@users.calebasse.invalid');
insert into public.profiles (id, first_name, last_name, phone, global_role) values
  ('00000000-0000-0000-0000-0000000000e1', 'Super', 'Admin', '770000801', 'super_admin'),
  ('00000000-0000-0000-0000-0000000000e2', 'Awa', 'Générale', '770000802', 'user'),
  ('00000000-0000-0000-0000-0000000000e3', 'Ousmane', 'Financier', '770000803', 'user'),
  ('00000000-0000-0000-0000-0000000000e4', 'Khady', 'Projets', '770000804', 'user'),
  ('00000000-0000-0000-0000-0000000000e5', 'Ibou', 'Validateur', '770000805', 'user'),
  ('00000000-0000-0000-0000-0000000000e6', 'Fatou', 'Militante', '770000806', 'user');

create temp table ids (k text primary key, id uuid) on commit drop;
grant all on ids to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1"}', true);
insert into ids select 'org', public.organization_save(null, 'Organisation financement', 'OFI', 'ofi',
  '#1A5BA8', null);
select public.organization_set_role((select id from ids where k = 'org'), '770000802', 'org_admin', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e2"}', true);
select public.organization_set_role((select id from ids where k = 'org'), '770000803', 'finance_admin', true);
select public.organization_set_role((select id from ids where k = 'org'), '770000804', 'projects_manager', true);
select public.organization_set_role((select id from ids where k = 'org'), '770000805', 'validator', true);
insert into ids select 'jeunes', public.structure_save((select id from ids where k = 'org'), null,
  'Mouvement des jeunes', 'mouvement', null, null, null, null);

reset role;
insert into public.structure_members (structure_id, user_id, status, decided_at)
values ((select id from ids where k = 'jeunes'), '00000000-0000-0000-0000-0000000000e6', 'active', now());
select private.ensure_active_org_member((select id from ids where k = 'org'), '00000000-0000-0000-0000-0000000000e6');
select private.entry_move(private.entry_create((select id from ids where k = 'org'), 'don', 500000,
  'Don au fonds commun', '{}'::jsonb), 'treasury', null, 'common', null, 500000);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e6"}', true);
insert into ids select 'fin', public.org_financing_submit('ofi', (select id from ids where k = 'jeunes'),
  'pret', 'Atelier de couture', 'Achat de deux machines à coudre pour un atelier de quartier.',
  200000, 'Machines 180 000, tissus 20 000', 12, 'Créer deux emplois', 'Jeunes du quartier');
select is(public.my_financings('ofi') -> 'rows' -> 0 ->> 'status', 'submitted',
  'a member submits a financing request');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e4"}', true);
select lives_ok(format($$ select public.org_financing_check(%L, true, 'Dossier complet') $$,
  (select id from ids where k = 'fin')), 'the projects manager checks the file');
select lives_ok(format($$ select public.org_financing_evaluate(%L,
  '{"pertinence":12,"viabilite":11,"faisabilite":8,"impact":8,"budget":4,"capacite":4}', 'Bon projet', null) $$,
  (select id from ids where k = 'fin')), 'the projects manager scores the project');
select is((public.org_financing_view((select id from ids where k = 'fin')) ->> 'projectScore')::int, 47,
  'the project score is the sum of the six criteria (out of 60)');
select throws_ok(format($$ select public.org_financing_decide(%L, true, 200000, null, 'common', null,
  true, 2, (current_date + 30), 'ok') $$, (select id from ids where k = 'fin')),
  '42501', null, 'the evaluator cannot decide');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e5"}', true);
select lives_ok(format($$ select public.org_financing_decide(%L, true, 150000,
  'Remboursement en 2 fois', 'common', null, true, 2, (current_date + 30), 'Accordé en partie') $$,
  (select id from ids where k = 'fin')), 'the validation authority grants a loan');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e3"}', true);
select lives_ok(format($$ select public.org_financing_disburse(%L, 150000, 'wave', 'WAVE-123', 'Décaissé') $$,
  (select id from ids where k = 'fin')), 'the finance department disburses');
reset role;
select is(private.account_balance((select id from ids where k = 'org'), 'common')::int, 350000,
  'the disbursement leaves the common fund');
set local role authenticated;
select lives_ok(format($$ select public.org_financing_repay(%L, 75000, 'cash', null) $$,
  (select id from ids where k = 'fin')), 'a first repayment is recorded');
select is((public.org_financing_view((select id from ids where k = 'fin')) ->> 'amountRepaid')::int, 75000,
  'the repaid amount is tracked');

select * from finish();
rollback;
