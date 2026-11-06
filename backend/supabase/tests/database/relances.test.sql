begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d2', 'd-admin@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000d3', 'd-awa@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000d4', 'd-ibou@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000d5', 'd-autre@users.calebasse.invalid');
insert into public.profiles (id, first_name, last_name, phone, global_role, language) values
  ('00000000-0000-0000-0000-0000000000d2', 'Moussa', 'Diop', '770000952', 'admin', 'fr'),
  ('00000000-0000-0000-0000-0000000000d3', 'Awa', 'Fall', '770000953', 'user', 'wo'),
  ('00000000-0000-0000-0000-0000000000d4', 'Ibou', 'Sarr', '770000954', 'user', 'fr'),
  ('00000000-0000-0000-0000-0000000000d5', 'Autre', 'Admin', '770000955', 'admin', 'fr');

insert into public.communities (id, name) values ('00000000-0000-0000-0000-0000000000dc', 'Test relance');
insert into public.community_admins (community_id, admin_id)
values ('00000000-0000-0000-0000-0000000000dc', '00000000-0000-0000-0000-0000000000d2');

create temp table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated, service_role;
create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p)::text, true);
$$;

-- Groupe démarré : Moussa (admin), Awa et Ibou ; tour 1 en cours.
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
insert into ids select 'g', public.group_create(jsonb_build_object(
  'name', 'Tontine relance', 'contributionAmount', 5000, 'frequency', 'monthly', 'turnLength', 1,
  'maxMembers', 3, 'paymentDueDay', 5, 'startDate', (current_date + 10)::text));
select public.membership_add_by_phone((select id from ids where name = 'g'), '770000953', 1);
select public.membership_add_by_phone((select id from ids where name = 'g'), '770000954', 1);
select public.order_draw((select id from ids where name = 'g'));
select public.group_start((select id from ids where name = 'g'));
insert into ids select 'r', id from public.rounds
  where group_id = (select id from ids where name = 'g') and number = 1;
-- Ibou a payé (espèces) : il ne doit pas être relancé.
select public.payment_record_cash((select id from ids where name = 'r'), '00000000-0000-0000-0000-0000000000d4');

reset role;
set local role service_role;

select throws_ok(
  $$select public.svc_reminder_prepare('00000000-0000-0000-0000-0000000000d5',
      (select id from ids where name = 'r'))$$,
  '42501', null, 'an admin of another group cannot remind');
select throws_ok(
  $$select public.svc_reminder_prepare('00000000-0000-0000-0000-0000000000d2',
      (select id from ids where name = 'r'), '00000000-0000-0000-0000-0000000000d4')$$,
  '22023', 'Ce membre a déjà payé.', 'a member who paid is not reminded');

create temp table res (j jsonb) on commit drop;
grant all on res to service_role;
insert into res select public.svc_reminder_prepare('00000000-0000-0000-0000-0000000000d2',
  (select id from ids where name = 'r'));

select is(
  (select array_agg(t ->> 'firstName' order by t ->> 'firstName')
   from res, jsonb_array_elements(j -> 'targets') t),
  array['Awa', 'Moussa'], 'everyone who has not paid is reminded, not Ibou');
select is(
  (select t ->> 'language' from res, jsonb_array_elements(j -> 'targets') t
   where t ->> 'firstName' = 'Awa'),
  'wo', 'the member language comes back for the SMS');
select is(
  (select (t ->> 'amount')::int from res, jsonb_array_elements(j -> 'targets') t
   where t ->> 'firstName' = 'Awa'),
  5000, 'the amount due is returned');
select is((select j ->> 'groupName' from res), 'Tontine relance', 'the group name is returned');

select throws_ok(
  $$select public.svc_reminder_prepare('00000000-0000-0000-0000-0000000000d2',
      (select id from ids where name = 'r'))$$,
  '23505', null, 'a second reminder the same day is refused');
select throws_ok(
  $$select public.svc_reminder_prepare('00000000-0000-0000-0000-0000000000d2',
      (select id from ids where name = 'r'), '00000000-0000-0000-0000-0000000000d3')$$,
  '23505', 'Ce membre a déjà été relancé aujourd’hui. Réessayez demain.',
  'one member cannot be reminded twice a day either');

reset role;
select is(
  (select count(*)::int from public.notifications
   where user_id = '00000000-0000-0000-0000-0000000000d3' and type = 'reminder'),
  1, 'the member gets one in-app reminder');
select is(
  (select count(*)::int from public.audit_log
   where action = 'reminder_sent' and group_id = (select id from ids where name = 'g')),
  1, 'the reminder is in the audit log');
select is(public.svc_sms_template('late', 'wo') like 'Salaam%', true, 'Wolof template for Wolof members');
select is(public.svc_sms_template('late', 'xx') like 'Bonjour%', true, 'French template by default');

select * from finish();
rollback;
