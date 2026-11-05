begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000091', 'dashboard-super@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-000000000092', 'dashboard-admin@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-000000000093', 'dashboard-pinned@users.calebasse.invalid');

insert into public.profiles (id, first_name, last_name, phone, global_role) values
  ('00000000-0000-0000-0000-000000000091', 'Super', 'Admin', '770000091', 'super_admin'),
  ('00000000-0000-0000-0000-000000000092', 'Awa', 'Admin', '770000092', 'admin'),
  ('00000000-0000-0000-0000-000000000093', 'Moussa', 'Admin', '770000093', 'admin');

insert into private.auth_pins (user_id, pin_hash, must_reset) values
  ('00000000-0000-0000-0000-000000000093', 'test-hash', false);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000091"}',
  true
);
select is(
  (select pin_pending from public.admin_pin_pending(array[
    '00000000-0000-0000-0000-000000000093'::uuid
  ]) where user_id = '00000000-0000-0000-0000-000000000093'),
  false,
  'super admin can see that an admin PIN is ready without reading its hash'
);
select is(
  (select pin_pending from public.admin_pin_pending(array[
    '00000000-0000-0000-0000-000000000092'::uuid
  ]) where user_id = '00000000-0000-0000-0000-000000000092'),
  true,
  'super admin sees a missing PIN as pending'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000092"}',
  true
);
select throws_ok(
  $$select * from public.admin_pin_pending(array['00000000-0000-0000-0000-000000000093'::uuid])$$,
  '42501',
  null,
  'regular admin cannot read PIN status'
);

select * from finish();
rollback;
