begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a2', 'r-admin@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000a3', 'r-awa@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000a4', 'r-ibou@users.calebasse.invalid');
insert into public.profiles (id, first_name, last_name, phone, global_role, payout_phone) values
  ('00000000-0000-0000-0000-0000000000a2', 'Moussa', 'Diop', '770000982', 'admin', '770000982'),
  ('00000000-0000-0000-0000-0000000000a3', 'Awa', 'Fall', '770000983', 'user', '770000983'),
  ('00000000-0000-0000-0000-0000000000a4', 'Ibou', 'Sarr', '770000984', 'user', '770000984');
insert into public.communities (id, name) values ('00000000-0000-0000-0000-0000000000ac', 'Test retards');
insert into public.community_admins (community_id, admin_id)
values ('00000000-0000-0000-0000-0000000000ac', '00000000-0000-0000-0000-0000000000a2');

create temp table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated;
create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p)::text, true);
$$;
create function pg_temp.id(p text) returns uuid language sql as $$
  select id from ids where name = p;
$$;

-- 1 000 FCFA par mois, pénalité 500 ; ordre : Moussa (tour 1), Awa (2), Ibou (3).
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
insert into ids select 'g', public.group_create(jsonb_build_object(
  'name', 'Tontine retards', 'contributionAmount', 1000, 'frequency', 'monthly', 'turnLength', 1,
  'maxMembers', 3, 'paymentDueDay', 5, 'latePenalty', 500, 'startDate', (current_date + 1)::text));
select public.membership_add_by_phone(pg_temp.id('g'), '770000983', 1);
select public.membership_add_by_phone(pg_temp.id('g'), '770000984', 1);
select public.order_set(pg_temp.id('g'), array(
  select m.id from public.memberships m where m.group_id = pg_temp.id('g') order by m.user_id));
select public.group_start(pg_temp.id('g'));
insert into ids select 'r' || number, id from public.rounds where group_id = pg_temp.id('g');

-- Heure limite.
select throws_ok($$select public.group_set_due_time(pg_temp.id('g'), '25:00')$$,
  '22023', 'Heure limite invalide (format HH:MM).', 'the due time must be HH:MM');
select lives_ok($$select public.group_set_due_time(pg_temp.id('g'), '12:00')$$,
  'the admin sets the due time');

-- Tour 1 : Moussa et Ibou paient, Awa non.
select public.payment_record_cash(pg_temp.id('r1'), '00000000-0000-0000-0000-0000000000a2');
select public.payment_record_cash(pg_temp.id('r1'), '00000000-0000-0000-0000-0000000000a4');
select throws_ok($$select public.round_payout(pg_temp.id('r1'))$$,
  '22023', null, 'no payout with unpaid members before the due time');

-- La date limite d'hier à 12h est passée.
reset role;
update public.rounds set open_date = current_date - 2, due_date = current_date - 1 where id = pg_temp.id('r1');
select is(private.round_deadline(pg_temp.id('r1')),
  ((current_date - 1)::timestamp + time '12:00') at time zone 'Africa/Dakar',
  'the deadline is the due date at the chosen time (Dakar)');
select is(private.apply_late_penalties(), 1, 'only Awa gets a late penalty');
select is(private.apply_late_penalties(), 0, 'the penalty is applied once per round');
select is(private.member_status(pg_temp.id('r1'), '00000000-0000-0000-0000-0000000000a3')::text,
  'late', 'Awa is late');
select is(private.amount_due(pg_temp.id('r1'), '00000000-0000-0000-0000-0000000000a3')::int,
  1500, 'Awa owes her contribution plus the penalty');

-- Versement malgré l'impayé : Moussa reçoit ce qui a été collecté, Awa a une dette.
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$select public.round_payout(pg_temp.id('r1'))$$,
  'after the due time the admin pays out anyway');
reset role;
select is((select amount from public.round_beneficiaries where round_id = pg_temp.id('r1')),
  2000, 'the beneficiary gets what was collected');
select is(
  (select array[amount, penalty_amount] from public.debts
   where round_id = pg_temp.id('r1') and user_id = '00000000-0000-0000-0000-0000000000a3'),
  array[1000, 500], 'the unpaid contribution and penalty become a debt');
select is((select status::text from public.rounds where id = pg_temp.id('r2')),
  'open', 'the group goes on: round 2 is open');

-- Confidentialité : Ibou ne voit pas la dette d'Awa, Awa la voit.
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a4');
select is((select count(*)::int from public.debts), 0, 'other members do not see the debt');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from public.debts), 1, 'the debtor sees her debt');

-- Tour 2 (Awa bénéficiaire) : tout le monde paie ; sa dette est retenue sur sa cagnotte.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select public.payment_record_cash(pg_temp.id('r2'), u)
from unnest(array['00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3',
  '00000000-0000-0000-0000-0000000000a4']::uuid[]) u;
select public.round_payout(pg_temp.id('r2'));
reset role;
select is(
  (select array[amount, withheld] from public.round_beneficiaries where round_id = pg_temp.id('r2')),
  array[1500, 1500], 'the debt is withheld from her pot');
select is(
  (select status::text || '/' || settled_via::text from public.debts
   where user_id = '00000000-0000-0000-0000-0000000000a3'),
  'settled/withheld', 'the debt is settled by withholding');
select is(
  (select sum(amount)::int from public.platform_earnings
   where group_id = pg_temp.id('g') and kind = 'late_penalty'),
  500, 'the withheld penalty is platform income');

-- Tour 3 (Ibou bénéficiaire) : Awa ne paie pas ; versement, dette, puis remboursement en espèces.
update public.rounds set open_date = current_date - 2, due_date = current_date - 1 where id = pg_temp.id('r3');
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select public.payment_record_cash(pg_temp.id('r3'), '00000000-0000-0000-0000-0000000000a2');
select public.payment_record_cash(pg_temp.id('r3'), '00000000-0000-0000-0000-0000000000a4');
select public.round_payout(pg_temp.id('r3'));
insert into ids select 'd', id from public.debts where round_id = pg_temp.id('r3');
select lives_ok($$select public.debt_record_payment(pg_temp.id('d'))$$,
  'the admin records a cash repayment');
select throws_ok($$select public.debt_record_payment(pg_temp.id('d'))$$,
  '22023', 'Cette dette est déjà réglée.', 'a debt is repaid once');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a4');
select throws_ok($$select public.debt_record_payment(pg_temp.id('d'))$$,
  '42501', null, 'a member cannot settle a debt');

select * from finish();
rollback;
