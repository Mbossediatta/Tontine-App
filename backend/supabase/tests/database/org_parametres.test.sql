begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'set-super@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000f2', 'set-admin@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000f3', 'set-validator@users.calebasse.invalid');
insert into public.profiles (id, first_name, last_name, phone, global_role) values
  ('00000000-0000-0000-0000-0000000000f1', 'Super', 'Admin', '770000401', 'super_admin'),
  ('00000000-0000-0000-0000-0000000000f2', 'Awa', 'Générale', '770000402', 'user'),
  ('00000000-0000-0000-0000-0000000000f3', 'Ibou', 'Validateur', '770000403', 'user');

create temp table ids (k text primary key, id uuid) on commit drop;
grant all on ids to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f1"}', true);
insert into ids select 'org', public.organization_save(null, 'Organisation paramètres', 'OPS', 'ops',
  '#1A5BA8', null);
select public.organization_set_role((select id from ids where k = 'org'), '770000402', 'org_admin', true);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2"}', true);
select lives_ok(
  $$ select public.organization_set_role((select id from ids where k = 'org'), '770000403', 'validator', true) $$,
  'the general admin names a member of the validation authority');

select is(
  public.organization_settings('ops') -> 'settings' -> 'reminderOffsets',
  '[-5, -2, 0, 3, 7, 15]'::jsonb,
  'default reminders follow the specification (J-5 to J+15)');

select is(
  public.organization_settings_update('ops',
    '{"reminderOffsets":[7,-3,0,-3],"expenseCeiling":250000,"receiptFooter":"Merci"}')
    -> 'reminderOffsets',
  '[-3, 0, 7]'::jsonb,
  'reminders are sorted and deduplicated');

select is((public.organization_settings('ops') -> 'settings' ->> 'expenseCeiling')::int, 250000,
  'the expense ceiling is saved');

select throws_ok(
  $$ select public.organization_settings_update('ops', '{"reminderOffsets":[90]}') $$,
  '22023', null, 'a reminder too far after the due date is refused');

select throws_ok(
  $$ select public.organization_settings_update('ops', '{"unknownKey":1}') $$,
  '22023', null, 'an unknown setting is refused');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f3"}', true);
select is((public.organization_settings('ops') ->> 'canEdit')::boolean, false,
  'the validation authority reads the settings without editing them');
select throws_ok(
  $$ select public.organization_settings_update('ops', '{"expenseCeiling":1}') $$,
  '42501', null, 'only the general admin changes the settings');

reset role;
select is(
  (select summary from public.audit_log where action = 'org_settings_updated'
   order by at desc limit 1) like '%expenseCeiling%',
  true, 'the change is written in the audit log');

select * from finish();
rollback;
