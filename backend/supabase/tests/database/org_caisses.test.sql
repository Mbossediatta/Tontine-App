begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'fund-super@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000b2', 'fund-admin@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000b3', 'fund-treasurer@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000b4', 'fund-member@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000b5', 'fund-secretary@users.calebasse.invalid');

insert into public.profiles (id, first_name, last_name, phone, global_role) values
  ('00000000-0000-0000-0000-0000000000b1', 'Super', 'Admin', '770000201', 'super_admin'),
  ('00000000-0000-0000-0000-0000000000b2', 'Awa', 'Général', '770000202', 'user'),
  ('00000000-0000-0000-0000-0000000000b3', 'Modou', 'Trésorier', '770000203', 'user'),
  ('00000000-0000-0000-0000-0000000000b4', 'Fatou', 'Militante', '770000204', 'user'),
  ('00000000-0000-0000-0000-0000000000b5', 'Binta', 'Secrétaire', '770000205', 'user');

create temp table ids (k text primary key, id uuid) on commit drop;
grant all on ids to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1"}', true);
insert into ids select 'org', public.organization_save(null, 'Organisation test', 'OTS', 'ots',
  '#1A5BA8', null);
select public.organization_set_role((select id from ids where k = 'org'), '770000202',
  'org_admin', true);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2"}', true);
insert into ids select 'femmes', public.structure_save((select id from ids where k = 'org'), null,
  'Mouvement des femmes', 'mouvement', null, null, null, null);
select public.structure_set_role((select id from ids where k = 'femmes'), '770000203', 'tresorier', true);
select public.structure_set_role((select id from ids where k = 'femmes'), '770000205', 'secretaire', true);

-- La militante est membre depuis 3 mois (inscrite et validée directement pour le test).
reset role;
insert into public.organization_members (organization_id, user_id, member_number, status, joined_at)
values ((select id from ids where k = 'org'), '00000000-0000-0000-0000-0000000000b4',
  'OTS-000099', 'active', now() - interval '3 months');
insert into public.structure_members (structure_id, user_id, status, requested_at, decided_at)
values ((select id from ids where k = 'femmes'), '00000000-0000-0000-0000-0000000000b4', 'active',
  now() - interval '3 months', now() - interval '3 months');
set local role authenticated;

-- La secrétaire ne crée pas de caisse ; le trésorier oui.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b5"}', true);
select throws_ok(
  format($$select public.org_fund_save(%L, null, 'Cotisation mensuelle', 'cotisation', 2000,
    'monthly', (current_date - interval '4 months')::date, 5, null)$$, (select id from ids where k = 'femmes')),
  '42501', null, 'a secretary cannot create a fund');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b3"}', true);
insert into ids select 'mensuelle', public.org_fund_save((select id from ids where k = 'femmes'), null,
  'Cotisation mensuelle', 'cotisation', 2000, 'monthly',
  (current_date - interval '4 months')::date, 5, null);
insert into ids select 'adhesion', public.org_fund_save((select id from ids where k = 'femmes'), null,
  'Frais d''adhésion', 'adhesion', 5000, 'monthly', (current_date - interval '1 year')::date, 5, null);

reset role;
select ok(
  (select count(*) from public.org_installments
   where fund_id = (select id from ids where k = 'mensuelle'))::int between 3 and 5,
  'monthly installments are generated from the member arrival up to the next due date');
select is(
  (select count(*)::int from public.org_installments
   where fund_id = (select id from ids where k = 'mensuelle') and due_date >= current_date),
  1, 'exactly one upcoming installment is generated in advance');
select is(
  (select frequency::text from public.org_funds where id = (select id from ids where k = 'adhesion')),
  'once', 'a membership fee is a one-time fund');
select is(
  (select count(*)::int from public.org_installments
   where fund_id = (select id from ids where k = 'adhesion')),
  1, 'one membership fee installment per member');
select is(
  (select sum(late)::int from (
     select case when private.org_installment_status(i) = 'late' then 1 else 0 end as late
     from public.org_installments i where i.fund_id = (select id from ids where k = 'mensuelle')) x)
  , (select count(*)::int from public.org_installments
     where fund_id = (select id from ids where k = 'mensuelle') and due_date < current_date),
  'past unpaid installments are late, without any penalty');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b3"}', true);
select throws_ok(
  format($$select public.org_payment_record(%L, '00000000-0000-0000-0000-0000000000b4', 2000, 'wave', null)$$,
    (select id from ids where k = 'mensuelle')),
  '22023', null, 'a mobile money payment needs its transaction reference');
select throws_ok(
  format($$select public.org_payment_record(%L, '00000000-0000-0000-0000-0000000000b4', 99999, 'cash', null)$$,
    (select id from ids where k = 'mensuelle')),
  '22023', null, 'a payment cannot exceed what is left to pay');

insert into ids select 'pay1', public.org_payment_record((select id from ids where k = 'mensuelle'),
  '00000000-0000-0000-0000-0000000000b4', 3000, 'cash', null);

reset role;
select is(
  (select amount_paid from public.org_installments
   where fund_id = (select id from ids where k = 'mensuelle')
   order by due_date limit 1), 2000, 'the oldest installment is settled first');
select ok(
  (select paid_at::date > due_date from public.org_installments
   where fund_id = (select id from ids where k = 'mensuelle') order by due_date limit 1),
  'a late payment keeps the trace of the delay');
select is(
  (select amount_paid from public.org_installments
   where fund_id = (select id from ids where k = 'mensuelle') order by due_date offset 1 limit 1),
  1000, 'the rest goes to the next installment (partial payment)');
select matches(
  (select receipt_number from public.org_payments where id = (select id from ids where k = 'pay1')),
  '^OTS-R[0-9]{4}-000001$', 'the receipt number is generated');

-- Paiements consolidés : l'admin général et le super admin (lecture) voient le paiement.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2"}', true);
select is(
  (public.organization_payments_page('ots') -> 'summary' ->> 'amount')::int, 3000,
  'the general admin sees all payments of the organization with their total');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1"}', true);
select is((public.organization_payments_page('ots') -> 'summary' ->> 'count')::int, 1,
  'the super admin can read the payments');
reset role;

-- Le trésorier qui a saisi ne peut pas annuler ; l'admin général oui, avec motif.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b3"}', true);
select throws_ok(
  format($$select public.org_payment_cancel(%L, 'Erreur')$$, (select id from ids where k = 'pay1')),
  '42501', null, 'the treasurer cannot cancel a payment');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2"}', true);
select public.org_payment_cancel((select id from ids where k = 'pay1'), 'Saisie en double');
reset role;
select is(
  (select sum(amount_paid)::int from public.org_installments
   where fund_id = (select id from ids where k = 'mensuelle')), 0,
  'cancelling a payment releases its installments');
select is(
  (select count(*)::int from public.org_payments where id = (select id from ids where k = 'pay1')),
  1, 'a cancelled payment is kept in the history');

-- Le super admin consulte une caisse mais ne peut pas y enregistrer de paiement.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1"}', true);
select lives_ok(
  format($$select public.org_fund_view(%L, null)$$, (select id from ids where k = 'mensuelle')),
  'the super admin can open a fund (read only)');
select throws_ok(
  format($$select public.org_payment_record(%L, '00000000-0000-0000-0000-0000000000b4', 1000, 'cash', null)$$,
    (select id from ids where k = 'mensuelle')),
  '42501', null, 'the super admin cannot record a payment');

select * from finish();
rollback;
