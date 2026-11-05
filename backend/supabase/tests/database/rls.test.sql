-- Tests des règles d'accès (étape 3). Lancer : npm run test:db
begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

-- ---------------------------------------------------------------------------
-- Données : un groupe G1 dans la communauté K.
--   S  super admin            A  admin responsable de G1 (n'y cotise pas)
--   M1, M2 membres actifs     R  demande d'adhésion en attente
--   X  personne extérieure    Z  membre actif mais suspendu
--   C  admin de la communauté K (aucun droit sur G1)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email)
select ('00000000-0000-0000-0000-00000000000' || n)::uuid, n || '@users.calebasse.invalid'
from generate_series(1, 8) n;

insert into public.profiles (id, first_name, last_name, phone, global_role, is_suspended) values
  ('00000000-0000-0000-0000-000000000001', 'Super', 'Admin', '770000001', 'super_admin', false),
  ('00000000-0000-0000-0000-000000000002', 'Awa', 'Admin', '770000002', 'admin', false),
  ('00000000-0000-0000-0000-000000000003', 'Moussa', 'Un', '770000003', 'user', false),
  ('00000000-0000-0000-0000-000000000004', 'Fatou', 'Deux', '770000004', 'user', false),
  ('00000000-0000-0000-0000-000000000005', 'Rama', 'Attente', '770000005', 'user', false),
  ('00000000-0000-0000-0000-000000000006', 'Xavier', 'Dehors', '770000006', 'user', false),
  ('00000000-0000-0000-0000-000000000007', 'Zeyna', 'Suspendue', '770000007', 'user', true),
  ('00000000-0000-0000-0000-000000000008', 'Cheikh', 'Communaute', '770000008', 'admin', false);

insert into public.communities (id, name) values
  ('10000000-0000-0000-0000-000000000001', 'Ouakam');
insert into public.community_admins (community_id, admin_id) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000008');

insert into public.groups (id, community_id, name, contribution_amount, frequency, max_members,
  payment_due_day, start_date, status, created_by, admin_id) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Famille',
   10000, 'monthly', 10, 5, '2026-11-01', 'active',
   '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002');

insert into public.memberships (id, group_id, user_id, status, payout_order) values
  ('50000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 'active', 1),
  ('50000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004', 'active', 2),
  ('50000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000005', 'pending', null),
  ('50000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000007', 'active', 3);

insert into public.rounds (id, group_id, number, open_date, due_date, status) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 1,
   '2026-11-01', '2026-11-05', 'open');

insert into public.payments (id, round_id, user_id, amount, contribution_amount,
  service_fee_amount, method, status, paid_at) values
  ('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000003', 10000, 10000, 150, 'wave', 'paid', now()),
  ('40000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000004', 10000, 10000, 150, 'wave', 'pending', null);

insert into public.notifications (id, user_id, type, title, body) values
  ('60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003',
   'payment', 'Paiement reçu', 'Merci !');

insert into public.security_events (kind, severity, detail) values
  ('pin_failed', 'warning', 'PIN incorrect (1er essai)');

-- ---------------------------------------------------------------------------
-- Visiteur non connecté (clé publique)
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok('select * from public.profiles', '42501', null, 'anon : aucune table lisible');
select throws_ok('select * from public.groups', '42501', null, 'anon : pas de groupes');
select throws_ok('select public.public_settings()', '42501', null, 'anon : pas de paramètres');

-- ---------------------------------------------------------------------------
-- Membre M1
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003"}', true);

select is((select count(*) from public.profiles)::int, 1, 'M1 : ne voit que son profil (pas les numéros des autres)');
select is((select count(*) from public.groups)::int, 1, 'M1 : voit son groupe');
select is((select count(*) from public.memberships)::int, 3, 'M1 : voit les parts actives, pas la demande en attente');
select is((select count(*) from public.rounds)::int, 1, 'M1 : voit les tours');
select is((select count(*) from public.payments)::int, 1, 'M1 : ne voit que son paiement');
select is((select count(*) from public.communities)::int, 1, 'M1 : voit la communauté de son groupe');
select is((select count(*) from public.platform_settings)::int, 0, 'M1 : pas les paramètres complets');
select is((select count(*) from public.security_events)::int, 0, 'M1 : pas le journal de sécurité');
select ok(not (public.public_settings() -> 'payment' ? 'secretKeyHint'), 'M1 : paramètres publics sans indice de clé');
select is(
  (select array_agg(first_name order by first_name) from public.public_profiles(array[
    '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000006']::uuid[])),
  array['Awa', 'Fatou'],
  'M1 : nom des membres et de l''admin du groupe, pas des demandeurs ni des inconnus');

select lives_ok($$update public.profiles set first_name = 'Moussa B' where id = '00000000-0000-0000-0000-000000000003'$$,
  'M1 : modifie son prénom');
select throws_ok($$update public.profiles set global_role = 'super_admin' where id = '00000000-0000-0000-0000-000000000003'$$,
  '42501', null, 'M1 : ne peut pas changer son rôle');
select throws_ok($$update public.profiles set is_suspended = false$$, '42501', null,
  'M1 : ne peut pas lever une suspension');
update public.profiles set first_name = 'Pirate' where id = '00000000-0000-0000-0000-000000000004';
select throws_ok($$insert into public.payments (round_id, user_id, amount, contribution_amount, method, status, paid_at)
  values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 10000, 10000, 'cash', 'paid', now())$$,
  '42501', null, 'M1 : ne peut pas se déclarer payé');
select lives_ok($$update public.notifications set read = true where id = '60000000-0000-0000-0000-000000000001'$$,
  'M1 : marque sa notification comme lue');
select throws_ok($$update public.notifications set title = 'x'$$, '42501', null,
  'M1 : ne peut pas réécrire une notification');
select throws_ok('select * from private.auth_pins', '42501', null, 'M1 : pas d''accès aux PIN');

-- ---------------------------------------------------------------------------
-- Admin responsable A (gère G1 sans y cotiser)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002"}', true);
select is((select count(*) from public.profiles)::int, 5, 'A : son profil + les 4 personnes de son groupe (numéros compris)');
select is((select count(*) from public.memberships)::int, 4, 'A : voit aussi la demande en attente');
select is((select count(*) from public.payments)::int, 2, 'A : voit tous les paiements du groupe');

-- ---------------------------------------------------------------------------
-- Admin de communauté C : aucun droit sur les groupes de la communauté
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000008"}', true);
select is((select count(*) from public.communities)::int, 1, 'C : voit sa communauté');
select is((select count(*) from public.groups)::int, 0, 'C : ne voit pas le groupe qu''il ne gère pas');
select is((select count(*) from public.payments)::int, 0, 'C : ne voit pas les paiements');

-- ---------------------------------------------------------------------------
-- Personne extérieure X, demandeur R, compte suspendu Z
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000006"}', true);
select is((select count(*) from public.groups)::int, 0, 'X : ne voit aucun groupe');
select is((select count(*) from public.communities)::int, 0, 'X : ne voit aucune communauté');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000005"}', true);
select is((select count(*) from public.groups)::int, 1, 'R : voit le groupe demandé');
select is((select count(*) from public.rounds)::int, 0, 'R : ne voit pas les tours avant d''être accepté');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000007"}', true);
select is((select count(*) from public.profiles)::int, 0, 'Z suspendu : ne voit plus rien (profil)');
select is((select count(*) from public.groups)::int, 0, 'Z suspendu : ne voit plus rien (groupes)');

-- ---------------------------------------------------------------------------
-- Super admin
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001"}', true);
select is((select count(*) from public.profiles)::int, 8, 'S : voit tous les profils');
select is((select count(*) from public.security_events)::int, 1, 'S : voit le journal de sécurité');

-- Vérification finale, sans RLS : M1 n'a pas pu modifier le profil de M2.
reset role;
select is((select first_name from public.profiles where id = '00000000-0000-0000-0000-000000000004'),
  'Fatou', 'M1 n''a pas modifié le profil d''un autre membre');

select * from finish();
rollback;
