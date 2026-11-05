begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000081', 'create-super@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-000000000082', 'create-member@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-000000000083', 'create-new-admin@users.calebasse.invalid');

insert into public.profiles (id, first_name, last_name, phone, global_role) values
  ('00000000-0000-0000-0000-000000000081', 'Super', 'Admin', '770000081', 'super_admin'),
  ('00000000-0000-0000-0000-000000000082', 'Awa', 'Membre', '770000082', 'user');

set local role service_role;
select is(
  public.svc_admin_create(
    '00000000-0000-0000-0000-000000000081',
    '00000000-0000-0000-0000-000000000082',
    '770000082',
    'Awa',
    'Autre'
  ),
  '00000000-0000-0000-0000-000000000082'::uuid,
  'existing member is promoted without replacing their name'
);
select is(
  (select global_role from public.profiles where id = '00000000-0000-0000-0000-000000000082'),
  'admin'::public.global_role,
  'existing profile receives admin role'
);
select is(
  (select first_name || ' ' || last_name from public.profiles where id = '00000000-0000-0000-0000-000000000082'),
  'Awa Membre',
  'promotion preserves existing profile names'
);
select throws_ok(
  $$select public.svc_admin_create(
    '00000000-0000-0000-0000-000000000082',
    '00000000-0000-0000-0000-000000000083',
    '770000083',
    'Moussa',
    'Admin'
  )$$,
  '42501',
  null,
  'a regular admin cannot create another admin'
);
select is(
  (select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-000000000083'),
  0,
  'unauthorized creation leaves no profile'
);
select is(
  public.svc_admin_create(
    '00000000-0000-0000-0000-000000000081',
    '00000000-0000-0000-0000-000000000083',
    '770000083',
    'Moussa',
    'Admin'
  ),
  '00000000-0000-0000-0000-000000000083'::uuid,
  'new auth account receives an admin profile'
);
select is(
  (select count(*)::int from public.audit_log where action = 'admin_added'
     and actor_id = '00000000-0000-0000-0000-000000000081'),
  2,
  'each admin addition is recorded in audit log'
);

select * from finish();
rollback;
