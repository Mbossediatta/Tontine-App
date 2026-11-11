begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'dr-super@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000f2', 'dr-admin@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000f3', 'dr-projets@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000f4', 'dr-finance@users.calebasse.invalid');
insert into public.profiles (id, first_name, last_name, phone, global_role) values
  ('00000000-0000-0000-0000-0000000000f1', 'Super', 'Admin', '770000961', 'super_admin'),
  ('00000000-0000-0000-0000-0000000000f2', 'Awa', 'Générale', '770000962', 'user'),
  ('00000000-0000-0000-0000-0000000000f3', 'Ibou', 'Projets', '770000963', 'user'),
  ('00000000-0000-0000-0000-0000000000f4', 'Rama', 'Finances', '770000964', 'user');

create temp table ids (k text primary key, id uuid) on commit drop;
grant all on ids to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f1"}', true);
insert into ids select 'org', public.organization_save(null, 'Organisation droits', 'ODR', 'odr',
  '#1A5BA8', null);
select public.organization_set_role((select id from ids where k = 'org'), '770000962', 'org_admin', true);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2"}', true);
select public.organization_set_role((select id from ids where k = 'org'), '770000963', 'projects_manager', true);
select public.organization_set_role((select id from ids where k = 'org'), '770000964', 'finance_admin', true);

-- Par défaut : les droits d'avant.
select is(jsonb_array_length(public.org_permissions('odr') -> 'actions'), 11,
  'eleven configurable actions are listed');
reset role;
select is(private.org_roles_for((select id from ids where k = 'org'), 'expense_pay'),
  array['finance_admin']::public.org_role[], 'by default only the financial admin pays expenses');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2"}', true);

-- Garde-fous.
select throws_ok(
  $$ select public.organization_settings_update('odr', '{"permissions":{"expense_decide":["finance_admin"]}}') $$,
  '22023', null, 'the same role cannot both decide and pay an expense');
select throws_ok(
  $$ select public.organization_settings_update('odr', '{"permissions":{"projects":[]}}') $$,
  '22023', null, 'an action cannot be left to nobody');
select throws_ok(
  $$ select public.organization_settings_update('odr', '{"permissions":{"projects":["chef"]}}') $$,
  '22023', null, 'an unknown role is refused');

-- Le responsable des projets peut créer des projets… jusqu'à ce qu'on le lui retire.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f3"}', true);
select is((public.org_projects_list('odr', null, null) ->> 'canCreate')::boolean, true,
  'by default the projects manager creates projects');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f4"}', true);
select throws_ok(
  $$ select public.organization_settings_update('odr', '{"permissions":{"projects":["org_admin"]}}') $$,
  '42501', null, 'only the general admin changes the rights');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2"}', true);
select public.organization_settings_update('odr', '{"permissions":{"projects":["org_admin"]}}');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f3"}', true);
select is((public.org_projects_list('odr', null, null) ->> 'canCreate')::boolean, false,
  'once the right is removed, the projects manager can no longer create projects');
reset role;
select is(private.org_roles_for((select id from ids where k = 'org'), 'projects'),
  array['org_admin']::public.org_role[], 'the new setting is the one applied');

select * from finish();
rollback;
