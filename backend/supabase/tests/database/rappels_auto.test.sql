begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b2', 'ra-admin@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000b3', 'ra-awa@users.calebasse.invalid');
insert into public.profiles (id, first_name, last_name, phone, global_role, language) values
  ('00000000-0000-0000-0000-0000000000b2', 'Moussa', 'Diop', '770000992', 'admin', 'fr'),
  ('00000000-0000-0000-0000-0000000000b3', 'Awa', 'Fall', '770000993', 'user', 'wo');
insert into public.communities (id, name) values ('00000000-0000-0000-0000-0000000000bc', 'Test rappels');
insert into public.community_admins (community_id, admin_id)
values ('00000000-0000-0000-0000-0000000000bc', '00000000-0000-0000-0000-0000000000b2');

create temp table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated;
create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p)::text, true);
$$;
create function pg_temp.id(p text) returns uuid language sql as $$
  select id from ids where name = p;
$$;

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
insert into ids select 'g', public.group_create(jsonb_build_object(
  'name', 'Tontine rappels', 'contributionAmount', 1000, 'frequency', 'monthly', 'turnLength', 1,
  'maxMembers', 2, 'paymentDueDay', 5, 'startDate', (current_date + 1)::text));
select public.membership_add_by_phone(pg_temp.id('g'), '770000993', 1);
select public.order_draw(pg_temp.id('g'));
select public.group_start(pg_temp.id('g'));
select public.group_set_due_time(pg_temp.id('g'), '12:00');
insert into ids select 'r', id from public.rounds where group_id = pg_temp.id('g') and number = 1;
-- Moussa a payé ; la date limite est demain.
select public.payment_record_cash(pg_temp.id('r'), '00000000-0000-0000-0000-0000000000b2');
reset role;
update public.rounds set open_date = (now() at time zone 'Africa/Dakar')::date - 1,
  due_date = (now() at time zone 'Africa/Dakar')::date + 1 where id = pg_temp.id('r');

select is(private.send_due_reminders(), 1, 'only the member who has not paid is reminded');
select is(private.send_due_reminders(), 0, 'one automatic reminder per day');
select is(
  (select body from public.notifications
   where user_id = '00000000-0000-0000-0000-0000000000b3' and type = 'reminder'),
  'Salaam Awa, sa cotisation bu 1 000 FCFA ci « Tontine rappels » war na fay ba '
    || to_char((now() at time zone 'Africa/Dakar')::date + 1, 'DD/MM/YYYY') || ' à 12h00.',
  'the reminder uses the Wolof template with amount, date and due time');

-- Le rappel automatique compte pour la relance du jour.
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select throws_ok(
  $$select public.reminder_send(pg_temp.id('r'), '00000000-0000-0000-0000-0000000000b3')$$,
  '23505', null, 'no manual reminder on top of the automatic one the same day');
reset role;
select is(
  (select count(*)::int from cron.job
   where jobname in ('calebasse-rappels', 'calebasse-purge-codes', 'calebasse-penalites')),
  3, 'the three scheduled jobs exist');

-- Nettoyage des codes SMS.
insert into private.auth_otps (phone, code_hash, expires_at, created_at) values
  ('770000993', 'x', now() - interval '2 days', now() - interval '2 days'),
  ('770000993', 'y', now() + interval '5 minutes', now());
select cmp_ok(private.purge_old_otps(), '>=', 1, 'the purge deletes old codes');
select is((select count(*)::int from private.auth_otps where phone = '770000993' and code_hash = 'x'), 0,
  'codes older than a day are deleted');
select is((select count(*)::int from private.auth_otps where phone = '770000993'), 1,
  'recent codes are kept');

select * from finish();
rollback;
