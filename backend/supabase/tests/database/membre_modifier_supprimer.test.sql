begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f7', 'del-super@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000f8', 'del-member@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000f9', 'del-other@users.calebasse.invalid');
insert into public.profiles (id, first_name, last_name, phone, global_role) values
  ('00000000-0000-0000-0000-0000000000f7', 'Super', 'Admin', '770000951', 'super_admin'),
  ('00000000-0000-0000-0000-0000000000f8', 'Moussa', 'Ndiaye', '770000952', 'user'),
  ('00000000-0000-0000-0000-0000000000f9', 'Awa', 'Diop', '770000953', 'user');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f9"}', true);
select throws_ok($$ select public.member_update('00000000-0000-0000-0000-0000000000f8', 'Mamadou', 'Ndiaye') $$,
  '42501', null, 'only the super admin edits a member');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f7"}', true);
select lives_ok($$ select public.member_update('00000000-0000-0000-0000-0000000000f8', 'Mamadou', 'Ndiaye') $$,
  'the super admin corrects the name');
select throws_ok($$ select public.member_delete('00000000-0000-0000-0000-0000000000f8', '') $$,
  '22023', null, 'a reason is required');

select lives_ok($$ select public.member_delete('00000000-0000-0000-0000-0000000000f8', 'Demande du membre') $$,
  'the super admin deletes a member who has nothing in progress');

reset role;
select is((select first_name || ' ' || last_name from public.profiles
  where id = '00000000-0000-0000-0000-0000000000f8'), 'Compte supprimé', 'the account is anonymised');
select is((select phone from public.profiles where id = '00000000-0000-0000-0000-0000000000f8'), null,
  'the phone number is freed');
select ok((select deleted_at is not null and is_suspended from public.profiles
  where id = '00000000-0000-0000-0000-0000000000f8'), 'the account is closed');
select is((select count(*)::int from public.audit_log where action = 'member_deleted'
  and summary like '%Mamadou Ndiaye%'), 1, 'the deletion is in the audit log');

select * from finish();
rollback;
