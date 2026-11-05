begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

-- Comptes : super admin, deux admins, trois participants.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'g-super@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000a2', 'g-admin1@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000a3', 'g-admin2@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000b1', 'g-awa@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000b2', 'g-ibou@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000b3', 'g-khady@users.calebasse.invalid');

insert into public.profiles (id, first_name, last_name, phone, global_role) values
  ('00000000-0000-0000-0000-0000000000a1', 'Super', 'Admin', '770000901', 'super_admin'),
  ('00000000-0000-0000-0000-0000000000a2', 'Moussa', 'Diop', '770000902', 'admin'),
  ('00000000-0000-0000-0000-0000000000a3', 'Fatou', 'Ndiaye', '770000903', 'admin'),
  ('00000000-0000-0000-0000-0000000000b1', 'Awa', 'Fall', '770000911', 'user'),
  ('00000000-0000-0000-0000-0000000000b2', 'Ibou', 'Sarr', '770000912', 'user'),
  ('00000000-0000-0000-0000-0000000000b3', 'Khady', 'Ba', '770000913', 'user');

insert into public.communities (id, name) values
  ('00000000-0000-0000-0000-0000000000c1', 'Ouakam test'),
  ('00000000-0000-0000-0000-0000000000c2', 'AFP test');
insert into public.community_admins (community_id, admin_id) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a2');

create temp table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated;

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p)::text, true);
$$;

-- Lectures du test qui ne doivent pas dépendre des règles d'accès du compte simulé.
create function pg_temp.code(n text) returns text language sql security definer as $$
  select invite_code from public.groups where id = (select id from ids where name = n);
$$;
create function pg_temp.share_of(u uuid) returns uuid language sql security definer as $$
  select id from public.memberships where user_id = u and status <> 'removed' limit 1;
$$;

set local role authenticated;

-- --- Création --------------------------------------------------------------

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok(
  $$select public.group_create('{"name":"Tontine Awa","contributionAmount":5000,"frequency":"monthly","maxMembers":4,"paymentDueDay":5,"startDate":"2030-01-05"}')$$,
  '42501', null, 'a participant cannot create a group');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a3');
select throws_ok(
  $$select public.group_create('{"name":"Tontine Fatou","contributionAmount":5000,"frequency":"monthly","maxMembers":4,"paymentDueDay":5,"startDate":"2030-01-05"}')$$,
  '22023', 'Affectez d’abord votre compte à une communauté.',
  'an admin without community cannot create a group');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select throws_ok(
  $$select public.group_create('{"name":"Tontine Chère","contributionAmount":100,"frequency":"monthly","maxMembers":4,"paymentDueDay":5,"startDate":"2030-01-05"}')$$,
  '22023', null, 'contribution below the platform minimum is refused');
select throws_ok(
  $$select public.group_create('{"name":"<script>x</script>","contributionAmount":5000,"frequency":"monthly","maxMembers":4,"paymentDueDay":5,"startDate":"2030-01-05"}')$$,
  '22023', 'Ce texte contient des caractères non autorisés.', 'suspicious name is refused');

insert into ids select 'famille', public.group_create(
  '{"name":"Tontine Famille","contributionAmount":5000,"frequency":"monthly","maxMembers":3,"paymentDueDay":5,"startDate":"2030-01-05","dailyContribution":false,"joinPolicy":"community"}');

select is(
  (select community_id from public.groups where id = (select id from ids where name = 'famille')),
  '00000000-0000-0000-0000-0000000000c1'::uuid,
  'the group lands in the admin''s community');
select is(
  (select role::text || '/' || status::text from public.memberships
   where group_id = (select id from ids where name = 'famille')),
  'owner/active', 'the creating admin is the active owner');

-- Rythme et durée d'un tour, choisis par l'admin.
insert into ids select 'journalier', public.group_create(
  '{"name":"Tontine Journalière","contributionAmount":1000,"frequency":"daily","turnLength":30,"maxMembers":4,"paymentDueDay":1,"startDate":"2030-01-05"}');
select is(
  (select frequency::text || '/' || turn_length from public.groups where id = (select id from ids where name = 'journalier')),
  'daily/30', 'a daily group with 30-day turns is created');
select throws_ok(
  $$select public.group_create('{"name":"Tontine Longue","contributionAmount":5000,"frequency":"monthly","turnLength":25,"maxMembers":4,"paymentDueDay":5,"startDate":"2030-01-05"}')$$,
  '22023', 'Au plus 24 mois par tour.', 'a monthly turn cannot exceed two years');
select throws_ok(
  $$select public.group_create('{"name":"Tontine Semaine","contributionAmount":5000,"frequency":"weekly","turnLength":2,"maxMembers":4,"paymentDueDay":10,"startDate":"2030-01-05"}')$$,
  '22023', 'Choisissez un jour de la semaine.', 'a weekly group needs a weekday as due day');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'confie', public.group_create(
  '{"name":"Tontine Confiée","contributionAmount":2000,"frequency":"weekly","maxMembers":2,"paymentDueDay":3,"startDate":"2030-02-01","communityId":"00000000-0000-0000-0000-0000000000c2","adminId":"00000000-0000-0000-0000-0000000000a3"}');
select is(
  (select admin_id from public.groups where id = (select id from ids where name = 'confie')),
  '00000000-0000-0000-0000-0000000000a3'::uuid, 'super admin entrusts the group to an admin');
select is(
  (select count(*)::int from public.memberships where group_id = (select id from ids where name = 'confie')),
  0, 'super admin does not contribute to the group');

-- --- Rejoindre par code -----------------------------------------------------

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select is(
  (public.group_join_preview(pg_temp.code('famille')) ->> 'placesLeft')::int,
  2, 'join preview counts the free shares');
select throws_ok($$select public.group_join_preview('ZZZZZZ')$$, 'P0002', null,
  'unknown invite code');
select lives_ok(
  $$select public.group_request_join(lower(pg_temp.code('famille')))$$,
  'a participant requests to join with the code (case insensitive)');
select throws_ok(
  $$select public.group_request_join(pg_temp.code('famille'))$$,
  '22023', 'Vous avez déjà rejoint ce groupe.', 'a second request is refused');
select is(
  (select count(*)::int from public.groups where id = (select id from ids where name = 'famille')),
  1, 'the requester can read the group while pending');

-- Une autre participante ne gère pas le groupe : refus avec l'indice de traçage.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok(
  $$select public.membership_accept(pg_temp.share_of('00000000-0000-0000-0000-0000000000b1'))$$,
  '42501', 'Seuls les administrateurs du groupe peuvent faire cela.',
  'a non manager cannot accept a request');
select lives_ok($$select public.log_refusal('access_denied:Tontine Famille')$$,
  'the refusal can be traced afterwards');

-- --- Adhésions (admin du groupe) -------------------------------------------

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select lives_ok(
  $$select public.membership_accept((select id from public.memberships where user_id = '00000000-0000-0000-0000-0000000000b1'))$$,
  'the owner accepts the request');
select throws_ok(
  $$select public.membership_add_by_phone((select id from ids where name = 'famille'), '779999999', 1)$$,
  'P0002', null, 'an unknown number cannot be added');
select throws_ok(
  $$select public.membership_add_by_phone((select id from ids where name = 'famille'), '770000912', 2)$$,
  '22023', 'Toutes les parts configurées pour ce groupe sont attribuées.',
  'cannot add more shares than the group capacity');
select is(
  public.membership_add_by_phone((select id from ids where name = 'famille'), '77 000 09 12', 1),
  1, 'an existing account is added by phone');
select lives_ok(
  $$select public.membership_set_role((select id from public.memberships where user_id = '00000000-0000-0000-0000-0000000000b1'), 'co_admin')$$,
  'the owner names a co-admin');
select throws_ok(
  $$select public.membership_remove((select id from public.memberships where role = 'owner' and group_id = (select id from ids where name = 'famille')))$$,
  '22023', 'Le propriétaire ne peut pas être retiré.', 'the owner cannot be removed');
select lives_ok(
  $$select public.membership_remove((select id from public.memberships where user_id = '00000000-0000-0000-0000-0000000000b2'))$$,
  'a member is removed before the start');

-- --- Réglages ---------------------------------------------------------------

select lives_ok(
  $$select public.group_update((select id from ids where name = 'famille'), '{"name":"Tontine de la Famille","latePenalty":null,"memberStatusVisibility":"admins"}')$$,
  'the manager updates name, penalty and visibility');
select throws_ok(
  $$select public.group_update((select id from ids where name = 'famille'), '{"maxMembers":1}')$$,
  '22023', null, 'capacity cannot go below 2 shares');
select isnt(
  public.group_regenerate_invite((select id from ids where name = 'famille')),
  null, 'a new invite code is generated');

-- --- Supervision (super admin) ---------------------------------------------

select throws_ok(
  $$select public.group_suspend((select id from ids where name = 'famille'))$$,
  '42501', null, 'an admin cannot suspend a group');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.group_suspend((select id from ids where name = 'famille'))$$,
  'super admin suspends a group');
select lives_ok($$select public.group_reactivate((select id from ids where name = 'famille'))$$,
  'super admin reactivates it');
select is(
  (select status::text from public.groups where id = (select id from ids where name = 'famille')),
  'draft', 'a group without rounds goes back to draft');
select lives_ok(
  $$select public.group_transfer((select id from ids where name = 'famille'), '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a3')$$,
  'super admin transfers the group to another community and admin');
select is(
  (select role::text from public.memberships
   where group_id = (select id from ids where name = 'famille') and user_id = '00000000-0000-0000-0000-0000000000a2'),
  'member', 'the previous admin loses management rights but stays a member');
select throws_ok($$select public.group_archive((select id from ids where name = 'famille'))$$,
  '22023', null, 'only a finished group can be archived');

select ok(
  exists (select 1 from public.admin_choices() where id = '00000000-0000-0000-0000-0000000000a3'),
  'admin choices list the active admins');

-- Le nouvel admin responsable supprime le groupe en brouillon : le journal garde ses
-- entrées, leur lien vers le groupe passe à vide.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a3');
select lives_ok($$select public.group_remove((select id from ids where name = 'famille'))$$,
  'a draft group with audit entries can be removed');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select * from public.admin_choices()$$, '42501', null,
  'a participant cannot list admins');

reset role;
select is(
  (select count(*)::int from public.audit_log
   where summary like '%Tontine de la Famille%' and group_id is null),
  4, 'audit entries of the removed group remain, unlinked');
select throws_ok(
  $$update public.audit_log set summary = 'effacé' where summary like '%Tontine de la Famille%'$$,
  '42501', null, 'audit entries still cannot be rewritten');

select is(
  (select count(*)::int from public.audit_log
   where action in ('group_created', 'group_updated', 'group_suspended', 'group_reactivated',
     'group_community_changed')
     and actor_id in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2')),
  7, 'creations, update and supervision are in the audit log');

select * from finish();
rollback;
