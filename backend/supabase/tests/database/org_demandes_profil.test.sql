begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b7', 'prof-super@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000b8', 'prof-admin@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000b9', 'prof-member@users.calebasse.invalid');
insert into public.profiles (id, first_name, last_name, phone, global_role) values
  ('00000000-0000-0000-0000-0000000000b7', 'Super', 'Admin', '770000901', 'super_admin'),
  ('00000000-0000-0000-0000-0000000000b8', 'Awa', 'Générale', '770000902', 'user'),
  ('00000000-0000-0000-0000-0000000000b9', 'Fatou', 'Militante', '770000903', 'user');

create temp table ids (k text primary key, id uuid) on commit drop;
grant all on ids to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b7"}', true);
insert into ids select 'org', public.organization_save(null, 'Organisation profil', 'OPR', 'opr',
  '#1A5BA8', null);
select public.organization_set_role((select id from ids where k = 'org'), '770000902', 'org_admin', true);
reset role;
select private.ensure_active_org_member((select id from ids where k = 'org'), '00000000-0000-0000-0000-0000000000b9');
update public.organization_members set region = 'Dakar', departement = 'Pikine'
where user_id = '00000000-0000-0000-0000-0000000000b9';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b9"}', true);
insert into ids select 'req', public.my_profile_request_submit('opr', 'Thiès', 'Mbour', 'Saly', null,
  'J’ai déménagé');
select is((public.my_profile_requests('opr') -> 0 ->> 'status'), 'pending',
  'the member asks for a correction');
select throws_ok($$ select public.my_profile_request_submit('opr', 'Thiès', 'Mbour', null, null, null) $$,
  '23505', null, 'only one pending request at a time');
select throws_ok(format($$ select public.org_profile_request_decide(%L, true, null) $$,
  (select id from ids where k = 'req')), '42501', null, 'the member cannot approve her own request');

reset role;
select is((select departement from public.organization_members
  where user_id = '00000000-0000-0000-0000-0000000000b9'), 'Pikine',
  'nothing changes before the validation');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b8"}', true);
select is(jsonb_array_length(public.org_profile_requests('opr')), 1, 'the general admin sees the request');
select lives_ok(format($$ select public.org_profile_request_decide(%L, true, 'Vérifié') $$,
  (select id from ids where k = 'req')), 'the general admin approves');

reset role;
select is((select departement from public.organization_members
  where user_id = '00000000-0000-0000-0000-0000000000b9'), 'Mbour',
  'the member file is updated after the validation');

select * from finish();
rollback;
