begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

-- Calendrier : mêmes dates que tontine-pwa/src/lib/tontine.test.ts.
select is(private.round_due_date('2026-01-11', 'daily', 1, 10), '2026-01-20'::date,
  'daily turn of 10 days ends on its last day');
select is(private.add_periods('2026-01-01', 'monthly', 2), '2026-03-01'::date,
  'a 2-month turn opens the next turn 2 months later');
select is(private.round_due_date('2026-03-01', 'monthly', 5, 2), '2026-04-05'::date,
  'monthly due day falls in the last month of the turn');
select is(private.round_due_date('2026-01-01', 'weekly', 1, 3), '2026-01-19'::date,
  'weekly due day falls in the last week of the turn');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'c-super@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000c2', 'c-admin@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000c3', 'c-awa@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000c4', 'c-ibou@users.calebasse.invalid');
insert into public.profiles (id, first_name, last_name, phone, global_role, payout_phone) values
  ('00000000-0000-0000-0000-0000000000c1', 'Super', 'Admin', '770000961', 'super_admin', null),
  ('00000000-0000-0000-0000-0000000000c2', 'Moussa', 'Diop', '770000962', 'admin', '770000962'),
  ('00000000-0000-0000-0000-0000000000c3', 'Awa', 'Fall', '770000963', 'user', '770000963'),
  ('00000000-0000-0000-0000-0000000000c4', 'Ibou', 'Sarr', '770000964', 'user', null);
insert into public.communities (id, name) values ('00000000-0000-0000-0000-0000000000cc', 'Test cycle');
insert into public.community_admins (community_id, admin_id)
values ('00000000-0000-0000-0000-0000000000cc', '00000000-0000-0000-0000-0000000000c2');

create temp table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated;
create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p)::text, true);
$$;
create function pg_temp.round_of(n integer) returns uuid language sql security definer as $$
  select id from public.rounds where group_id = (select id from ids where name = 'g') and number = n
    and cycle = (select current_cycle from public.groups where id = (select id from ids where name = 'g'));
$$;

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');

-- Groupe mensuel, tours de 2 mois, 2 parts (l'admin et Awa), frais d'adhésion, tour réservé.
insert into ids select 'g', public.group_create(jsonb_build_object(
  'name', 'Tontine cycle', 'contributionAmount', 5000, 'frequency', 'monthly', 'turnLength', 2,
  'maxMembers', 2, 'paymentDueDay', 5, 'startDate', (current_date + 10)::text,
  'collectMembershipFee', true, 'membershipFeeAmount', 1000, 'reserveFinalTurn', true));
select public.membership_add_by_phone((select id from ids where name = 'g'), '770000963', 1);

select throws_ok($$select public.group_start((select id from ids where name = 'g'))$$,
  '22023', 'Fixez d’abord l’ordre des bénéficiaires.', 'the order must be set before starting');
select lives_ok($$select public.order_draw((select id from ids where name = 'g'))$$,
  'the manager draws the order');
select is(
  (select array_agg((o ->> 'payoutOrder')::int order by (o ->> 'payoutOrder')::int)
   from jsonb_array_elements(public.group_order_view(array[(select id from ids where name = 'g')])
     -> 'orders') o),
  array[1, 2], 'each share gets one place (the manager sees the whole order)');
select lives_ok(
  $$select public.order_set((select id from ids where name = 'g'), array(
      select id from public.memberships where group_id = (select id from ids where name = 'g')
      order by (user_id = '00000000-0000-0000-0000-0000000000c3') desc))$$,
  'the manager sets the order by hand (Awa first)');
select lives_ok($$select public.group_start((select id from ids where name = 'g'))$$,
  'the group starts');

select is(
  (select count(*)::int from public.rounds where group_id = (select id from ids where name = 'g')),
  3, 'two member turns plus the reserved turn');
select is(
  (select pot_amount from public.rounds where id = pg_temp.round_of(1)),
  20000, 'pot = 5 000 × 2 months × 2 shares');
select is(
  (select due_date - open_date from public.rounds where id = pg_temp.round_of(3)) >= 28,
  true, 'the reserved turn lasts as long as the others');
select throws_ok($$select public.order_draw((select id from ids where name = 'g'))$$,
  '22023', null, 'the order is locked after the start');

-- Tour 1 : paiements en espèces, puis versement à Awa.
select throws_ok($$select public.round_payout(pg_temp.round_of(1))$$,
  '22023', 'Tous les membres doivent avoir payé, ou l’heure limite doit être passée, avant le reversement.', 'no payout before everyone paid');
select lives_ok($$select public.payment_record_cash(pg_temp.round_of(1), '00000000-0000-0000-0000-0000000000c3')$$,
  'cash payment from Awa');
select throws_ok($$select public.payment_record_cash(pg_temp.round_of(1), '00000000-0000-0000-0000-0000000000c3')$$,
  '22023', 'Ce membre a déjà payé.', 'a second payment is refused');
select is(
  (public.group_round_statuses(array[(select id from ids where name = 'g')])
    -> pg_temp.round_of(1)::text ->> 'paidCount')::int,
  1, 'one share paid');
select lives_ok($$select public.payment_record_cash(pg_temp.round_of(1), '00000000-0000-0000-0000-0000000000c2')$$,
  'cash payment from the admin');
select is((select status::text from public.rounds where id = pg_temp.round_of(1)),
  'ready_for_payout', 'the turn is ready once every share is paid');
select lives_ok($$select public.round_payout(pg_temp.round_of(1))$$, 'payout of turn 1');
select is(
  (select b.amount from public.round_beneficiaries b join public.memberships m on m.id = b.membership_id
   where b.round_id = pg_temp.round_of(1) and m.user_id = '00000000-0000-0000-0000-0000000000c3'),
  20000, 'Awa receives the whole pot');
select is((select status::text from public.rounds where id = pg_temp.round_of(2)), 'open',
  'turn 2 opens');

-- Tour 2 : les frais d'adhésion ne sont plus dus.
select public.payment_record_cash(pg_temp.round_of(2), '00000000-0000-0000-0000-0000000000c3');
select is(
  (select membership_fee_amount from public.payments
   where round_id = pg_temp.round_of(2) and user_id = '00000000-0000-0000-0000-0000000000c3'),
  0, 'the membership fee is paid only once');
select public.payment_record_cash(pg_temp.round_of(2), '00000000-0000-0000-0000-0000000000c2');
select public.round_payout(pg_temp.round_of(2));

-- Tour réservé : versé par le super admin seulement.
select public.payment_record_cash(pg_temp.round_of(3), '00000000-0000-0000-0000-0000000000c3');
select public.payment_record_cash(pg_temp.round_of(3), '00000000-0000-0000-0000-0000000000c2');
select throws_ok($$select public.round_payout(pg_temp.round_of(3))$$,
  '42501', null, 'only the super admin collects the reserved turn');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select public.round_payout(pg_temp.round_of(3))$$,
  'the super admin collects the reserved turn');

reset role;
select is(
  (select array_agg(kind::text || ':' || amount order by kind, amount) from public.platform_earnings
   where group_id = (select id from ids where name = 'g')),
  array['membership_fee:1000', 'membership_fee:1000', 'reserved_turn:20000'],
  'platform earnings: two membership fees and the reserved turn');
select is((select status::text from public.groups where id = (select id from ids where name = 'g')),
  'finished', 'the cycle is finished');

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select lives_ok(
  $$select public.group_restart_cycle((select id from ids where name = 'g'), current_date + 5, false)$$,
  'a new cycle starts in draft');
reset role;
select is(
  (select status::text || '/' || current_cycle from public.groups where id = (select id from ids where name = 'g')),
  'draft/2', 'the group is back in draft for cycle 2');

select * from finish();
rollback;
