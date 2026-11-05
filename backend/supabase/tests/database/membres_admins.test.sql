begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'm-super@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000d2', 'm-admin1@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000d3', 'm-admin2@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000d4', 'm-member@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000d5', 'm-new@users.calebasse.invalid');

insert into public.profiles (id, first_name, last_name, phone, global_role, payout_phone) values
  ('00000000-0000-0000-0000-0000000000d1', 'Super', 'Admin', '770000951', 'super_admin', null),
  ('00000000-0000-0000-0000-0000000000d2', 'Moussa', 'Diop', '770000952', 'admin', null),
  ('00000000-0000-0000-0000-0000000000d3', 'Fatou', 'Ndiaye', '770000953', 'admin', null),
  ('00000000-0000-0000-0000-0000000000d4', 'Awa', 'Fall', '770000954', 'user', '770000954');

insert into public.communities (id, name) values ('00000000-0000-0000-0000-0000000000dc', 'Test membres');
insert into public.community_admins (community_id, admin_id)
values ('00000000-0000-0000-0000-0000000000dc', '00000000-0000-0000-0000-0000000000d2');
insert into public.groups (name, contribution_amount, frequency, max_members, payment_due_day,
  start_date, created_by, admin_id, community_id)
values ('Groupe de Moussa', 5000, 'monthly', 4, 5, current_date + 30,
  '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d2',
  '00000000-0000-0000-0000-0000000000dc');

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p)::text, true);
$$;

set local role authenticated;

-- Seul le super admin agit sur les comptes.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select throws_ok($$select public.member_block('00000000-0000-0000-0000-0000000000d4')$$,
  '42501', null, 'an admin cannot block a member');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select throws_ok($$select public.member_block('00000000-0000-0000-0000-0000000000d1')$$,
  '42501', 'Le compte du super administrateur ne se gère pas ici.',
  'the super admin account is not managed here');
select lives_ok($$select public.member_block('00000000-0000-0000-0000-0000000000d4')$$,
  'super admin blocks a member');
select lives_ok($$select public.member_unblock('00000000-0000-0000-0000-0000000000d4')$$,
  'super admin unblocks a member');

-- Administrateurs.
select throws_ok(
  $$select public.admin_update('00000000-0000-0000-0000-0000000000d2', 'Moussa', 'Diop', '770000954')$$,
  '23505', 'Ce numéro est déjà utilisé par un autre compte.', 'an admin cannot take a used number');
select throws_ok(
  $$select public.admin_update('00000000-0000-0000-0000-0000000000d2', 'M0ussa', 'Diop', '770000952')$$,
  '22023', null, 'names keep letters only');
select lives_ok(
  $$select public.admin_update('00000000-0000-0000-0000-0000000000d2', 'Moussa', 'N''Diop', '77 000 09 52')$$,
  'super admin updates an admin (apostrophe, spaced number)');
select throws_ok($$select public.admin_revoke('00000000-0000-0000-0000-0000000000d2')$$,
  '23505', 'Réattribuez d’abord ses 1 groupe à un autre administrateur.',
  'an admin still responsible for a group keeps the role');
select lives_ok($$select public.admin_suspend('00000000-0000-0000-0000-0000000000d3')$$,
  'super admin suspends an admin');
select throws_ok(
  $$select public.admin_reassign_groups('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d3')$$,
  '22023', 'Cet administrateur est suspendu.', 'groups cannot go to a suspended admin');
select lives_ok($$select public.admin_reactivate('00000000-0000-0000-0000-0000000000d3')$$,
  'super admin reactivates an admin');
select is(
  public.admin_reassign_groups('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d3'),
  1, 'groups are reassigned');
select lives_ok($$select public.admin_revoke('00000000-0000-0000-0000-0000000000d2')$$,
  'the role is removed once the groups are reassigned');

-- Fonctions des Edge Functions (service_role).
reset role;
set local role service_role;
select throws_ok(
  $$select public.svc_member_create('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d5', '770000954', 'Nouveau', 'Membre')$$,
  '23505', 'Un compte existe déjà avec ce numéro.', 'member creation refuses a used number');
select lives_ok(
  $$select public.svc_phone_change('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d4', '770000959')$$,
  'phone change after the SMS check');

reset role;
select is(
  (select phone || '/' || payout_phone || '/' || (select global_role::text from public.profiles
     where id = '00000000-0000-0000-0000-0000000000d2')
   from public.profiles where id = '00000000-0000-0000-0000-0000000000d4'),
  '770000959/770000959/user', 'payout number follows the phone; the removed admin is a user');

select * from finish();
rollback;
