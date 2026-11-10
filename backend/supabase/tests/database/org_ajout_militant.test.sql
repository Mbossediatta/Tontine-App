begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'add-super@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000c2', 'add-admin@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000c3', 'add-new@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000c4', 'add-other@users.calebasse.invalid');
insert into public.profiles (id, first_name, last_name, phone, global_role) values
  ('00000000-0000-0000-0000-0000000000c1', 'Super', 'Admin', '770000301', 'super_admin'),
  ('00000000-0000-0000-0000-0000000000c2', 'Awa', 'Général', '770000302', 'user'),
  ('00000000-0000-0000-0000-0000000000c4', 'Ibou', 'Autre', '770000304', 'user');

create temp table ids (k text primary key, id uuid) on commit drop;
grant all on ids to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1"}', true);
insert into ids select 'org', public.organization_save(null, 'Organisation ajout', 'ADD', 'add',
  '#1A5BA8', null);
select public.organization_set_role((select id from ids where k = 'org'), '770000302', 'org_admin', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2"}', true);
insert into ids select 'jeunes', public.structure_save((select id from ids where k = 'org'), null,
  'Mouvement des jeunes', 'mouvement', null, null, null, null);
reset role;

-- Un compte sans rôle ne peut pas inscrire.
select throws_ok(
  format($$select public.svc_org_member_add('00000000-0000-0000-0000-0000000000c4', %L,
    '00000000-0000-0000-0000-0000000000c3', true, '770000303', 'Fatou', 'Nouvelle', 'Dakar', 'Pikine', null, null)$$,
    (select id from ids where k = 'jeunes')),
  '42501', null, 'an account without a role cannot add a member');

-- L'admin général inscrit un nouveau numéro : compte, fiche, numéro et adhésion active.
select is(
-- L'admin général a reçu ADD-000001 à sa nomination (un responsable est membre).
  public.svc_org_member_add('00000000-0000-0000-0000-0000000000c2', (select id from ids where k = 'jeunes'),
    '00000000-0000-0000-0000-0000000000c3', true, '770000303', 'Fatou', 'Nouvelle', 'Dakar', 'Pikine',
    'Thiaroye', null) ->> 'memberNumber',
  'ADD-000002', 'the general admin adds a new member, who gets a number');
select is(
  (select status::text from public.structure_members
   where user_id = '00000000-0000-0000-0000-0000000000c3'),
  'active', 'the membership is active right away');
select is(
  (select phone from public.profiles where id = '00000000-0000-0000-0000-0000000000c3'),
  '770000303', 'the account is created with its phone number');
select throws_ok(
  format($$select public.svc_org_member_add('00000000-0000-0000-0000-0000000000c2', %L,
    '00000000-0000-0000-0000-0000000000c3', false, '770000303', null, null, 'Dakar', 'Pikine', null, null)$$,
    (select id from ids where k = 'jeunes')),
  '23505', null, 'a member cannot be added twice to the same structure');

-- Un compte existant (sans fiche AFP) est ajouté sans recréer de compte.
select is(
  public.svc_org_member_add('00000000-0000-0000-0000-0000000000c2', (select id from ids where k = 'jeunes'),
    '00000000-0000-0000-0000-0000000000c4', false, '770000304', null, null, 'Thiès', 'Mbour', null, null)
    ->> 'memberNumber',
  'ADD-000003', 'an existing account is added as a member');
select is(
  (select count(*)::int from public.notifications
   where user_id in ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000c4')
     and title = 'ADD – Mouvement des jeunes'),
  2, 'each added member is notified');

select * from finish();
rollback;
