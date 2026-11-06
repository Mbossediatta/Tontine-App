begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f2', 'v-admin@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000f3', 'v-awa@users.calebasse.invalid');
insert into public.profiles (id, first_name, last_name, phone, global_role) values
  ('00000000-0000-0000-0000-0000000000f2', 'Moussa', 'Diop', '770000972', 'admin'),
  ('00000000-0000-0000-0000-0000000000f3', 'Awa', 'Fall', '770000973', 'user');
insert into public.communities (id, name) values ('00000000-0000-0000-0000-0000000000fc', 'Test versements');
insert into public.community_admins (community_id, admin_id)
values ('00000000-0000-0000-0000-0000000000fc', '00000000-0000-0000-0000-0000000000f2');
update public.platform_settings set rules = rules || '{"minContribution": 100}';

create temp table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated, service_role;
create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p)::text, true);
$$;
create function pg_temp.id(p text) returns uuid language sql as $$
  select id from ids where name = p;
$$;

-- 100 FCFA par jour, tours de 7 jours : Awa doit 700 FCFA sur son tour.
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
insert into ids select 'g', public.group_create(jsonb_build_object(
  'name', 'Tontine journalière', 'contributionAmount', 100, 'frequency', 'daily', 'turnLength', 7,
  'maxMembers', 2, 'paymentDueDay', 1, 'startDate', (current_date + 1)::text));
select public.membership_add_by_phone(pg_temp.id('g'), '770000973', 1);
select public.order_draw(pg_temp.id('g'));
select public.group_start(pg_temp.id('g'));
insert into ids select 'r', id from public.rounds where group_id = pg_temp.id('g') and number = 1;
create function pg_temp.status() returns text language sql as $$
  select private.member_status(pg_temp.id('r'), '00000000-0000-0000-0000-0000000000f3')::text;
$$;
create function pg_temp.due() returns int language sql as $$
  select private.amount_due(pg_temp.id('r'), '00000000-0000-0000-0000-0000000000f3')::int;
$$;

select throws_ok(
  $$select public.payment_record_cash(pg_temp.id('r'), '00000000-0000-0000-0000-0000000000f3', 0)$$,
  '22023', 'Nombre de jours ou de périodes invalide.', 'at least one day per installment');

-- Un jour (100), puis trois jours (300) : toujours en attente, le reste diminue.
select public.payment_record_cash(pg_temp.id('r'), '00000000-0000-0000-0000-0000000000f3', 1);
reset role;
select is(pg_temp.status(), 'pending', 'one day paid: the round is not paid yet');
select is(pg_temp.due(), 600, 'six days are left to pay');
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select public.payment_record_cash(pg_temp.id('r'), '00000000-0000-0000-0000-0000000000f3', 3);
reset role;
select is(pg_temp.due(), 300, 'three days are left after paying three more');
select is(
  (select array_agg(contribution_amount order by created_at) from public.payments
   where round_id = pg_temp.id('r') and user_id = '00000000-0000-0000-0000-0000000000f3'),
  array[100, 300], 'each installment is its own payment');

-- Paiement en ligne de deux jours : 200 FCFA, plus les frais du service de paiement.
set local role service_role;
create temp table prep (j jsonb) on commit drop;
insert into prep select public.svc_payment_prepare('00000000-0000-0000-0000-0000000000f3',
  pg_temp.id('r'), 'wave', 2);
select is((select (j ->> 'amount')::int from prep), 200, 'an online installment of two days');
-- Sans nombre de jours : tout le reste (300).
insert into prep select public.svc_payment_prepare('00000000-0000-0000-0000-0000000000f3',
  pg_temp.id('r'), 'wave');
select is((select (j ->> 'amount')::int from prep offset 1), 300, 'without days: the whole rest');
reset role;

-- Le reste en espèces : le tour est payé, plus rien n'est dû.
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select public.payment_record_cash(pg_temp.id('r'), '00000000-0000-0000-0000-0000000000f3');
reset role;
select is(pg_temp.status(), 'paid', 'the round is paid once the total is reached');
select is(pg_temp.due(), 0, 'nothing is left to pay');
select is(
  (select count(*)::int from public.payments where round_id = pg_temp.id('r')
     and user_id = '00000000-0000-0000-0000-0000000000f3' and status = 'paid'),
  3, 'three installments, all paid');
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select throws_ok(
  $$select public.payment_record_cash(pg_temp.id('r'), '00000000-0000-0000-0000-0000000000f3', 1)$$,
  '22023', 'Ce membre a déjà payé.', 'no installment once the round is paid');

select * from finish();
rollback;
