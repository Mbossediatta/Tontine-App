begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'pay-super@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000d2', 'pay-admin@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000d3', 'pay-treasurer@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000d4', 'pay-member@users.calebasse.invalid');
insert into public.profiles (id, first_name, last_name, phone, global_role) values
  ('00000000-0000-0000-0000-0000000000d1', 'Super', 'Admin', '770000501', 'super_admin'),
  ('00000000-0000-0000-0000-0000000000d2', 'Awa', 'Générale', '770000502', 'user'),
  ('00000000-0000-0000-0000-0000000000d3', 'Modou', 'Trésorier', '770000503', 'user'),
  ('00000000-0000-0000-0000-0000000000d4', 'Fatou', 'Militante', '770000504', 'user');

create temp table ids (k text primary key, id uuid) on commit drop;
grant all on ids to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1"}', true);
insert into ids select 'org', public.organization_save(null, 'Organisation paiement', 'OPY', 'opy',
  '#1A5BA8', null);
select public.organization_set_role((select id from ids where k = 'org'), '770000502', 'org_admin', true);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2"}', true);
insert into ids select 'jeunes', public.structure_save((select id from ids where k = 'org'), null,
  'Mouvement des jeunes', 'mouvement', null, null, null, null);
select public.structure_set_role((select id from ids where k = 'jeunes'), '770000503', 'tresorier', true);

-- La militante fait une demande d'adhésion : le trésorier n'est pas prévenu (pas responsable),
-- l'administration générale l'est (aucun responsable dans la structure).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d4"}', true);
reset role;
insert into public.structure_members (structure_id, user_id, status)
values ((select id from ids where k = 'jeunes'), '00000000-0000-0000-0000-0000000000d4', 'pending');
select is(
  (select audience from public.notifications
   where user_id = '00000000-0000-0000-0000-0000000000d2' and body like 'Nouvelle demande%'),
  'manager', 'a membership request reaches the general admin, as a management notification');
update public.structure_members set status = 'active', decided_at = now()
where user_id = '00000000-0000-0000-0000-0000000000d4';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d3"}', true);
insert into ids select 'adhesion', public.org_fund_save((select id from ids where k = 'jeunes'), null,
  'Frais d''adhésion', 'adhesion', 5000, 'monthly', current_date, 5, null);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d4"}', true);
select is(
  (public.my_org_payables('opy') -> 'funds' -> 0 ->> 'totalOpen')::int, 5000,
  'the member sees what she can pay online');

reset role;
select throws_ok(
  format($$ select public.svc_org_payment_prepare('00000000-0000-0000-0000-0000000000d4', %L, 9000, 'wave') $$,
    (select id from ids where k = 'adhesion')),
  '22023', null, 'she cannot pay more than what is left');
select throws_ok(
  format($$ select public.svc_org_payment_prepare('00000000-0000-0000-0000-0000000000d2', %L, 5000, 'wave') $$,
    (select id from ids where k = 'adhesion')),
  '42501', null, 'only a member of the structure pays its fund');
select throws_ok(
  format($$ select public.svc_org_payment_prepare('00000000-0000-0000-0000-0000000000d4', %L, 2000, 'wave') $$,
    (select id from ids where k = 'adhesion')),
  '22023', 'Les frais d’adhésion se paient en une fois, au montant exact.',
  'the membership fee is paid only at its exact amount');
select is(
  (select jsonb_agg(c -> 'amount') from jsonb_array_elements(
     public.my_org_payables('opy') -> 'funds' -> 0 -> 'choices') c)::text,
  '[5000]', 'the member is offered only the exact membership fee');

insert into ids select 'intent', (public.svc_org_payment_prepare('00000000-0000-0000-0000-0000000000d4',
  (select id from ids where k = 'adhesion'), 5000, 'wave') ->> 'intentId')::uuid;
select is(
  (select count(*)::int from public.org_payments p where p.user_id = '00000000-0000-0000-0000-0000000000d4'),
  0, 'a payment only started is never counted as received');
select is(
  public.svc_org_payment_confirm((select id from ids where k = 'intent'), 4000, 'TOK-1', null),
  'mismatch', 'a confirmation with the wrong amount is refused');
select is(
  public.svc_org_payment_confirm((select id from ids where k = 'intent'),
    (select amount + service_fee from public.org_payment_intents where id = (select id from ids where k = 'intent')),
    'TOK-1', '770000504'),
  'ok', 'the PayTech confirmation records the payment');
select is(
  public.svc_org_payment_confirm((select id from ids where k = 'intent'),
    (select amount + service_fee from public.org_payment_intents where id = (select id from ids where k = 'intent')),
    'TOK-1', '770000504'),
  'already', 'the same notification twice changes nothing');
select is(
  (select count(*)::int from public.org_payments p where p.user_id = '00000000-0000-0000-0000-0000000000d4'),
  1, 'exactly one payment and one receipt');
select is(
  (select sum(amount_paid)::int from public.org_installments
   where fund_id = (select id from ids where k = 'adhesion')
     and user_id = '00000000-0000-0000-0000-0000000000d4'),
  5000, 'the membership fee is paid');
select is(
  (select count(*)::int from public.org_entries e
   where e.payment_id = (select payment_id from public.org_payment_intents where id = (select id from ids where k = 'intent'))
     and e.nature = 'recette'),
  1, 'the payment is written in the accounts of the structure');
select is(
  (select audience from public.notifications
   where user_id = '00000000-0000-0000-0000-0000000000d3' and body like '%en ligne%'),
  'manager', 'the treasurer is told about the online payment, as a management notification');
select is(
  (select audience from public.notifications
   where user_id = '00000000-0000-0000-0000-0000000000d4' and body like 'Paiement de%reçu%'),
  'member', 'the member gets her receipt notification in her own tab');

select * from finish();
rollback;
