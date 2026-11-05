begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000091', 'community-super@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-000000000092', 'community-admin-a@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-000000000093', 'community-admin-b@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-000000000094', 'community-member@users.calebasse.invalid');

insert into public.profiles (id, first_name, last_name, phone, global_role) values
  ('00000000-0000-0000-0000-000000000091', 'Super', 'Admin', '770000091', 'super_admin'),
  ('00000000-0000-0000-0000-000000000092', 'Awa', 'Admin', '770000092', 'admin'),
  ('00000000-0000-0000-0000-000000000093', 'Moussa', 'Admin', '770000093', 'admin'),
  ('00000000-0000-0000-0000-000000000094', 'Fatou', 'Membre', '770000094', 'user');

set local role authenticated;

-- Un admin ne peut pas créer de communauté.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000092"}', true);
select throws_ok(
  $$select public.community_save(null, 'Ouakam', null,
    array['00000000-0000-0000-0000-000000000092']::uuid[])$$,
  '42501',
  null,
  'an admin cannot create a community'
);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000091"}', true);
select throws_ok(
  $$select public.community_save(null, 'Ouakam', null, '{}'::uuid[])$$,
  '22023',
  null,
  'a community needs at least one admin'
);
select throws_ok(
  $$select public.community_save(null, 'Ouakam', null,
    array['00000000-0000-0000-0000-000000000094']::uuid[])$$,
  '22023',
  null,
  'a member cannot be assigned to a community'
);

create temp table saved (id uuid) on commit drop;
grant all on saved to authenticated;
insert into saved
select public.community_save(null, '  Ouakam ', 'Groupes du quartier',
  array['00000000-0000-0000-0000-000000000092']::uuid[]);

select is(
  (select name from public.communities where id = (select id from saved)),
  'Ouakam',
  'super admin creates a community with a trimmed name'
);
select throws_ok(
  $$select public.community_save(null, 'ouakam', null,
    array['00000000-0000-0000-0000-000000000092']::uuid[])$$,
  '23505',
  null,
  'community names are unique regardless of case'
);

select public.community_save((select id from saved), 'Ouakam Nord', null,
  array['00000000-0000-0000-0000-000000000093']::uuid[]);

select results_eq(
  $$select admin_id from public.community_admins where community_id = (select id from saved)$$,
  $$values ('00000000-0000-0000-0000-000000000093'::uuid)$$,
  'update replaces the assigned admins'
);
select is(
  (select description from public.communities where id = (select id from saved)),
  null,
  'an empty description is cleared'
);

reset role;
select is(
  (select count(*)::int from public.notifications
   where type = 'community' and user_id in (
     '00000000-0000-0000-0000-000000000092', '00000000-0000-0000-0000-000000000093')),
  2,
  'each newly assigned admin is notified once'
);
select is(
  (select count(*)::int from public.audit_log
   where action in ('community_created', 'community_updated')
     and actor_id = '00000000-0000-0000-0000-000000000091'),
  2,
  'creation and update are recorded in audit log'
);

-- L'admin retiré ne voit plus la communauté ; le nouvel admin la voit.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000093"}', true);
select is(
  (select count(*)::int from public.communities where id = (select id from saved)),
  1,
  'the assigned admin can read the community'
);

select * from finish();
rollback;
