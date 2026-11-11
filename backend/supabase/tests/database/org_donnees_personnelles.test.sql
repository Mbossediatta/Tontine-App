begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'dp-super@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000e2', 'dp-admin@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000e3', 'dp-member@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000e4', 'dp-left@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000e5', 'dp-pending@users.calebasse.invalid');
insert into public.profiles (id, first_name, last_name, phone, global_role) values
  ('00000000-0000-0000-0000-0000000000e1', 'Super', 'Admin', '770000951', 'super_admin'),
  ('00000000-0000-0000-0000-0000000000e2', 'Awa', 'Générale', '770000952', 'user'),
  ('00000000-0000-0000-0000-0000000000e3', 'Fatou', 'Militante', '770000953', 'user'),
  ('00000000-0000-0000-0000-0000000000e4', 'Modou', 'Sorti', '770000954', 'user'),
  ('00000000-0000-0000-0000-0000000000e5', 'Coumba', 'Attente', '770000955', 'user');

create temp table ids (k text primary key, id uuid) on commit drop;
grant all on ids to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1"}', true);
insert into ids select 'org', public.organization_save(null, 'Organisation données', 'ODP', 'odp',
  '#1A5BA8', null);
select public.organization_set_role((select id from ids where k = 'org'), '770000952', 'org_admin', true);
reset role;
select private.ensure_active_org_member((select id from ids where k = 'org'), '00000000-0000-0000-0000-0000000000e3');
select private.ensure_active_org_member((select id from ids where k = 'org'), '00000000-0000-0000-0000-0000000000e4');
update public.organization_members set region = 'Dakar', departement = 'Pikine'
where user_id in ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000e4');

-- Politique de confidentialité : lisible avant toute connexion.
set local role anon;
select ok(public.org_privacy('odp') ->> 'text' like '%loi n° 2008-12%',
  'the default privacy policy refers to the Senegalese law and is public');
select is((public.org_privacy('odp') ->> 'version')::int, 1, 'the first version is 1');
reset role;

-- Le membre accepte la version en vigueur, pas une autre.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e3"}', true);
select is((public.my_org_privacy_status('odp') ->> 'accepted'), null, 'nothing accepted at first');
select is((public.my_org_privacy_status('odp') ->> 'ready')::boolean, false,
  'nothing is asked of members while the organization keeps the default text');
select throws_ok($$ select public.org_privacy_accept('odp', 7) $$, '22023', null,
  'only the current version can be accepted');
select lives_ok($$ select public.org_privacy_accept('odp', 1) $$, 'the member accepts the policy');
select is((public.my_org_privacy_status('odp') ->> 'accepted')::int, 1, 'the acceptance is recorded');
select throws_ok($$ select public.org_privacy_save('odp', repeat('x', 300)) $$, '42501', null,
  'a member cannot change the policy');

-- Nouvelle version par l'administration générale : à accepter de nouveau.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e2"}', true);
select is((public.org_privacy_save('odp', 'Nouvelle politique. ' || repeat('Texte complet. ', 20))
  ->> 'version')::int, 2, 'the general admin publishes a new version');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e3"}', true);
select isnt((public.my_org_privacy_status('odp') ->> 'accepted')::int,
  (public.my_org_privacy_status('odp') ->> 'current')::int,
  'after a new version the member must accept again');

-- Droit d'accès : ses propres données, et seulement les siennes.
select is((public.my_org_data('odp') -> 'membership' ->> 'departement'), 'Pikine',
  'the member downloads her own data');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e5"}', true);
select throws_ok($$ select public.my_org_data('odp') $$, '42501', null,
  'someone outside the organization gets nothing');
reset role;

-- Durées de conservation.
update public.organization_members set status = 'left'
where user_id = '00000000-0000-0000-0000-0000000000e4';
select isnt((select left_at from public.organization_members
  where user_id = '00000000-0000-0000-0000-0000000000e4'), null,
  'the exit date is recorded when a member leaves');
update public.organization_members set left_at = now() - interval '6 years'
where user_id = '00000000-0000-0000-0000-0000000000e4';
insert into public.organization_members (organization_id, user_id, status, created_at)
values ((select id from ids where k = 'org'), '00000000-0000-0000-0000-0000000000e5', 'pending',
  now() - interval '13 months');
select private.org_apply_retention();
select is((select departement from public.organization_members
  where user_id = '00000000-0000-0000-0000-0000000000e4'), null,
  'the location of a member who left 5 years ago is erased');
select is((select count(*)::int from public.organization_members
  where user_id = '00000000-0000-0000-0000-0000000000e5'), 0,
  'a membership never validated for 12 months is erased');
select is((select departement from public.organization_members
  where user_id = '00000000-0000-0000-0000-0000000000e3'), 'Pikine',
  'an active member keeps her data');

select * from finish();
rollback;
