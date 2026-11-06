begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e2', 'e-admin@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000e3', 'e-awa@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000e4', 'e-ibou@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000e5', 'e-fatou@users.calebasse.invalid');
insert into public.profiles (id, first_name, last_name, phone, global_role) values
  ('00000000-0000-0000-0000-0000000000e2', 'Moussa', 'Diop', '770000962', 'admin'),
  ('00000000-0000-0000-0000-0000000000e3', 'Awa', 'Fall', '770000963', 'user'),
  ('00000000-0000-0000-0000-0000000000e4', 'Ibou', 'Sarr', '770000964', 'user'),
  ('00000000-0000-0000-0000-0000000000e5', 'Fatou', 'Ba', '770000965', 'user');

insert into public.communities (id, name) values ('00000000-0000-0000-0000-0000000000ec', 'Test échange');
insert into public.community_admins (community_id, admin_id)
values ('00000000-0000-0000-0000-0000000000ec', '00000000-0000-0000-0000-0000000000e2');

create temp table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated;
create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p)::text, true);
$$;
create function pg_temp.id(p text) returns uuid language sql as $$
  select id from ids where name = p;
$$;
create function pg_temp.round_of(p_user uuid) returns integer language sql as $$
  select r.number from public.round_beneficiaries b
  join public.rounds r on r.id = b.round_id
  join public.memberships m on m.id = b.membership_id
  where m.user_id = p_user and r.group_id = (select id from ids where name = 'g');
$$;

-- Groupe démarré, une part chacun, ordre : Moussa, Awa, Ibou, Fatou (tours 1 à 4).
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
insert into ids select 'g', public.group_create(jsonb_build_object(
  'name', 'Tontine échange', 'contributionAmount', 5000, 'frequency', 'monthly', 'turnLength', 1,
  'maxMembers', 4, 'paymentDueDay', 5, 'startDate', (current_date + 10)::text));
select public.membership_add_by_phone(pg_temp.id('g'), '770000963', 1);
select public.membership_add_by_phone(pg_temp.id('g'), '770000964', 1);
select public.membership_add_by_phone(pg_temp.id('g'), '770000965', 1);
select public.order_set(pg_temp.id('g'), array(
  select m.id from public.memberships m
  where m.group_id = pg_temp.id('g') order by m.user_id));
select public.group_start(pg_temp.id('g'));
insert into ids select 'r' || number, id from public.rounds where group_id = pg_temp.id('g');

-- Demandes.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e3');
select throws_ok(
  $$select public.swap_request(pg_temp.id('r2'), pg_temp.id('r1'), '00000000-0000-0000-0000-0000000000e2')$$,
  '22023', 'Seuls des tours à venir peuvent être échangés.', 'the open round cannot be swapped');
select throws_ok(
  $$select public.swap_request(pg_temp.id('r3'), pg_temp.id('r4'), '00000000-0000-0000-0000-0000000000e5')$$,
  '42501', 'Ce tour n’est pas le vôtre.', 'a member only offers their own round');
select throws_ok(
  $$select public.swap_request(pg_temp.id('r2'), pg_temp.id('r4'), '00000000-0000-0000-0000-0000000000e4')$$,
  '22023', 'Ce membre ne reçoit pas la cagnotte à ce tour.', 'the partner must hold that round');
insert into ids select 's', public.swap_request(pg_temp.id('r2'), pg_temp.id('r3'),
  '00000000-0000-0000-0000-0000000000e4');
select isnt(pg_temp.id('s'), null, 'Awa asks Ibou to swap rounds 2 and 3');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000e5');
select throws_ok(
  $$select public.swap_request(pg_temp.id('r4'), pg_temp.id('r2'), '00000000-0000-0000-0000-0000000000e3')$$,
  '23505', null, 'a part is in one open request at a time');
select is((select count(*)::int from public.swap_requests where group_id = pg_temp.id('g')),
  0, 'other members do not see the request');
select throws_ok($$select public.swap_respond(pg_temp.id('s'), true)$$,
  '42501', null, 'only the partner answers');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select throws_ok($$select public.swap_decide(pg_temp.id('s'), true)$$,
  '22023', 'L’autre membre doit d’abord accepter.', 'the admin waits for the partner');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000e4');
select lives_ok($$select public.swap_respond(pg_temp.id('s'), true)$$, 'Ibou accepts');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000e3');
select throws_ok($$select public.swap_decide(pg_temp.id('s'), true)$$,
  '42501', null, 'a plain member cannot approve');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select lives_ok($$select public.swap_decide(pg_temp.id('s'), true)$$, 'the admin approves');
select throws_ok($$select public.swap_decide(pg_temp.id('s'), true)$$,
  '22023', null, 'an approved swap cannot be decided again');

reset role;
select is(pg_temp.round_of('00000000-0000-0000-0000-0000000000e3'), 3, 'Awa now receives at round 3');
select is(pg_temp.round_of('00000000-0000-0000-0000-0000000000e4'), 2, 'Ibou now receives at round 2');
select is(
  (select array_agg(m.payout_order order by m.user_id) from public.memberships m
   where m.group_id = pg_temp.id('g')),
  array[1, 3, 2, 4], 'payout ranks are swapped too');
select is(
  (select count(*)::int from public.audit_log
   where action = 'swap_approved' and group_id = pg_temp.id('g')),
  1, 'the approval is in the audit log');

-- Annulation : seul l'auteur, tant que la demande est ouverte.
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e5');
insert into ids select 's2', public.swap_request(pg_temp.id('r4'), pg_temp.id('r2'),
  '00000000-0000-0000-0000-0000000000e4');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e4');
select throws_ok($$select public.swap_cancel(pg_temp.id('s2'))$$,
  '42501', null, 'only the requester cancels');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e5');
select public.swap_cancel(pg_temp.id('s2'));
select is((select status::text from public.swap_requests where id = pg_temp.id('s2')),
  'cancelled', 'the requester cancels an open request');

-- Calendrier confidentiel : Awa ne voit que ses propres tours.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e3');
select is(
  (select count(*)::int from public.round_beneficiaries b
   join public.rounds r on r.id = b.round_id where r.group_id = pg_temp.id('g')),
  1, 'a member only sees the beneficiary row of their own share');
select throws_ok($$select payout_order from public.memberships$$,
  '42501', null, 'the payout rank of others is not readable');
select is(jsonb_array_length(public.group_order_view(array[pg_temp.id('g')]) -> 'orders'),
  1, 'a member gets only their own rank');
select is((public.group_order_view(array[pg_temp.id('g')]) -> 'beneficiaryCounts' ->> pg_temp.id('r1')::text)::int,
  1, 'a member still knows how many people share each round');
-- Demande sur un tour anonyme : le serveur retrouve Fatou.
insert into ids select 's3', public.swap_request(pg_temp.id('r3'), pg_temp.id('r4'));
select is((select partner_id from public.swap_requests where id = pg_temp.id('s3')),
  '00000000-0000-0000-0000-0000000000e5'::uuid, 'the holder of an anonymous round is found');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e5');
select public.swap_respond(pg_temp.id('s3'), false);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select is(
  (select count(*)::int from public.round_beneficiaries b
   join public.rounds r on r.id = b.round_id where r.group_id = pg_temp.id('g')),
  4, 'the group admin sees every beneficiary');
reset role;
select is(
  (select body from public.notifications
   where user_id = '00000000-0000-0000-0000-0000000000e3' and type = 'swap_rejected'),
  'Le membre du tour 4 a refusé l’échange de tour.', 'the requester does not learn the name');

-- Statuts de paiement confidentiels : Awa ne reçoit que le sien, l'admin ceux de tous.
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e3');
select is(
  (select count(*)::int from jsonb_object_keys(
     public.group_round_statuses(array[pg_temp.id('g')]) -> pg_temp.id('r1')::text -> 'statuses')),
  1, 'a member only gets their own payment status');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select is(
  (select count(*)::int from jsonb_object_keys(
     public.group_round_statuses(array[pg_temp.id('g')]) -> pg_temp.id('r1')::text -> 'statuses')),
  4, 'the group admin gets every status');
reset role;

select * from finish();
rollback;
