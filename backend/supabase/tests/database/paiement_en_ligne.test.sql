begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e2', 'p-admin@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000e3', 'p-awa@users.calebasse.invalid');
insert into public.profiles (id, first_name, last_name, phone, global_role, payout_phone) values
  ('00000000-0000-0000-0000-0000000000e2', 'Moussa', 'Diop', '770000972', 'admin', '770000972'),
  ('00000000-0000-0000-0000-0000000000e3', 'Awa', 'Fall', '770000973', 'user', '770000973');
insert into public.communities (id, name) values ('00000000-0000-0000-0000-0000000000ec', 'Test paiement');
insert into public.community_admins (community_id, admin_id)
values ('00000000-0000-0000-0000-0000000000ec', '00000000-0000-0000-0000-0000000000e2');

create temp table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated, service_role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e2"}', true);
insert into ids select 'g', public.group_create(jsonb_build_object(
  'name', 'Tontine paiement', 'contributionAmount', 1000, 'frequency', 'daily', 'turnLength', 2,
  'maxMembers', 2, 'paymentDueDay', 1, 'startDate', current_date::text,
  'collectMembershipFee', true, 'membershipFeeAmount', 500, 'reserveFinalTurn', false));
select public.membership_add_by_phone((select id from ids where name = 'g'), '770000973', 1);
select public.order_draw((select id from ids where name = 'g'));
select public.group_start((select id from ids where name = 'g'));
reset role;
insert into ids select 'r', id from public.rounds where group_id = (select id from ids where name = 'g') and number = 1;

set local role service_role;
select throws_ok(
  $$select public.svc_payment_prepare('00000000-0000-0000-0000-0000000000e3', (select id from ids where name = 'r'), 'cash')$$,
  '22023', null, 'online payment needs a mobile money method');
insert into ids select 'p', (public.svc_payment_prepare(
  '00000000-0000-0000-0000-0000000000e3', (select id from ids where name = 'r'), 'wave') ->> 'paymentId')::uuid;
select is(
  (select amount || '/' || service_fee_amount || '/' || membership_fee_amount from public.payments
   where id = (select id from ids where name = 'p')),
  '2500/38/500', 'amount = 2 days × 1 000 + membership fee 500 ; PayTech fee 1.5 % rounded up');
select is(
  (public.svc_payment_prepare('00000000-0000-0000-0000-0000000000e3', (select id from ids where name = 'r'), 'orange_money') ->> 'paymentId')::uuid,
  (select id from ids where name = 'p'), 'a new attempt reuses the pending payment');
select is(public.svc_payment_confirm((select id from ids where name = 'p'), 2500, 'TOKEN-1', null),
  'mismatch', 'a notified amount without the PayTech fee is refused');
select is((select status::text from public.payments where id = (select id from ids where name = 'p')),
  'pending', 'nothing changes on mismatch');
select is(public.svc_payment_confirm((select id from ids where name = 'p'), 2538, 'TOKEN-1', '221770000973'),
  'ok', 'the exact amount confirms the payment');
select is(public.svc_payment_confirm((select id from ids where name = 'p'), 2538, 'TOKEN-1', null),
  'already', 'a repeated notification changes nothing');
select is(
  (select count(*)::int from public.platform_earnings
   where payment_id = (select id from ids where name = 'p') and kind = 'membership_fee'),
  1, 'the membership fee is recorded once as platform income');
select is(public.svc_payment_fail((select id from ids where name = 'p')), 'ignored',
  'a paid payment cannot be cancelled by a late notification');

select * from finish();
rollback;
