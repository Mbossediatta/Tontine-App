begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

-- Super admin, admin général AFP, responsable du département, militante, autre compte.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'org-super@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000a2', 'org-admin@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000a3', 'org-resp@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000a4', 'org-militante@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000a5', 'org-other@users.calebasse.invalid');

insert into public.profiles (id, first_name, last_name, phone, global_role) values
  ('00000000-0000-0000-0000-0000000000a1', 'Super', 'Admin', '770000101', 'super_admin'),
  ('00000000-0000-0000-0000-0000000000a2', 'Awa', 'Général', '770000102', 'user'),
  ('00000000-0000-0000-0000-0000000000a3', 'Moussa', 'Responsable', '770000103', 'user'),
  ('00000000-0000-0000-0000-0000000000a4', 'Fatou', 'Militante', '770000104', 'user'),
  ('00000000-0000-0000-0000-0000000000a5', 'Ibou', 'Autre', '770000105', 'user');

create temp table ids (k text primary key, id uuid) on commit drop;
grant all on ids to authenticated;

set local role authenticated;

-- Aucune lecture directe des tables de l'organisation.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1"}', true);
select throws_ok($$select count(*) from public.organizations$$, '42501', null,
  'organizations cannot be read directly, even by the super admin');

-- Seul le super admin crée une organisation.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2"}', true);
select throws_ok(
  $$select public.organization_save(null, 'Organisation de test', 'TST', 'tst', '#1A5BA8', null)$$,
  '42501', null, 'a member cannot create an organization');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1"}', true);
insert into ids select 'org', public.organization_save(null,
  'Alliance des Forces de Progrès', 'tst', 'TST', '#1A5BA8', null);
select is(public.organization_branding('tst') ->> 'shortName',
  'TST', 'short name and slug are normalized');
select throws_ok(
  $$select public.organization_save(null, 'Autre', 'TST', 'autre', '#1A5BA8', null)$$,
  '23505', null, 'short names are unique');

select public.organization_set_role((select id from ids where k = 'org'), '770000102',
  'org_admin', true);

-- Le super admin ne gère pas les structures.
select throws_ok(
  format($$select public.structure_save(%L, null, 'Dakar', 'departement', null, null, null, null)$$,
    (select id from ids where k = 'org')),
  '42501', null, 'the super admin cannot create structures');

-- L'admin général crée un département et une commune rattachée.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2"}', true);
insert into ids select 'dakar', public.structure_save((select id from ids where k = 'org'), null,
  'Département de Dakar', 'departement', null, null, null, null);
insert into ids select 'plateau', public.structure_save((select id from ids where k = 'org'), null,
  'Commune du Plateau', 'commune', (select id from ids where k = 'dakar'), null, null, null);
insert into ids select 'femmes', public.structure_save((select id from ids where k = 'org'), null,
  'Mouvement des femmes', 'mouvement', null, null, null, null);
select throws_ok(
  format($$select public.structure_save(%L, %L, 'Département de Dakar', 'departement', %L, null, null, null)$$,
    (select id from ids where k = 'org'), (select id from ids where k = 'dakar'),
    (select id from ids where k = 'plateau')),
  '22023', null, 'a structure cannot be attached to one of its own sub-structures');
select public.structure_set_role((select id from ids where k = 'dakar'), '770000103',
  'responsable', true);

select is(
  jsonb_array_length(public.organization_manage_view('tst') -> 'structures'), 3,
  'the general admin sees every structure');

-- Le responsable du département voit le département et sa commune, pas le mouvement.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3"}', true);
select is(
  jsonb_array_length(public.organization_manage_view('tst') -> 'structures'), 2,
  'a department head sees the department and its communes only');
select throws_ok(
  format($$select public.structure_view(%L)$$, (select id from ids where k = 'femmes')),
  '42501', null, 'a department head cannot open another structure');
select throws_ok(
  format($$select public.organization_members_page(%L)$$, (select id from ids where k = 'org')),
  '42501', null, 'only the general admin reads the central member file');

-- Un compte sans rôle n'a pas accès à l'administration.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a5"}', true);
select throws_ok($$select public.organization_manage_view('tst')$$, '42501', null,
  'an account without a role cannot open the administration');

-- La militante rejoint la commune par son code.
reset role;
create temp table codes (k text primary key, code text) on commit drop;
grant all on codes to authenticated;
insert into codes select 'plateau', invite_code from public.org_structures
  where id = (select id from ids where k = 'plateau');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a4"}', true);

select is(
  public.invite_branding((select code from codes where k = 'plateau')) ->> 'structureName', 'Commune du Plateau',
  'the invite code gives the organization branding before login');
select throws_ok(
  format($$select public.structure_join(%L, null, null, null, null)$$, (select code from codes where k = 'plateau')),
  '22023', null, 'region and department are required');
select lives_ok(
  format($$select public.structure_join(%L, 'Dakar', 'Dakar', 'Plateau', null)$$,
    (select code from codes where k = 'plateau')),
  'a member can request to join with the invite code');
select is(
  public.my_organizations() -> 0 -> 'structures' -> 0 ->> 'status', 'pending',
  'the request is pending');

-- Le responsable du département valide (la commune dépend de son département).
reset role;
insert into codes select 'request', id::text from public.structure_members
  where user_id = '00000000-0000-0000-0000-0000000000a4';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3"}', true);
select lives_ok(
  format($$select public.structure_member_decide(%L, true)$$,
    (select code from codes where k = 'request')),
  'the department head approves a request in a commune of the department');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a4"}', true);
-- Les deux responsables nommés plus haut ont reçu TST-000001 et TST-000002.
select is(
  public.my_organizations() -> 0 ->> 'memberNumber', 'TST-000003',
  'the first approval gives the member number');
select throws_ok(
  format($$select public.structure_join(%L, 'Dakar', 'Dakar', null, null)$$, (select code from codes where k = 'plateau')),
  '23505', null, 'a member cannot request the same structure twice');

-- Le super admin voit les chiffres globaux, sans fiche de militant.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1"}', true);
select is(
  (select (x ->> 'memberCount')::int from jsonb_array_elements(public.organizations_list()) x
   where x ->> 'shortName' = 'TST'), 3,
  'the super admin sees the number of active members');
select ok(
  not (public.organizations_list() -> 0 ? 'members'),
  'the super admin list holds no member file');

reset role;
select is(
  (select count(*)::int from public.notifications
   where user_id = '00000000-0000-0000-0000-0000000000a4' and title like 'TST – %'),
  1,
  'the member notification names the organization and the structure');

select * from finish();
rollback;
