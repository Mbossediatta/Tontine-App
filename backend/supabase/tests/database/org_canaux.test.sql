begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'can-super@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000c2', 'can-admin@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000c3', 'can-member@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000c4', 'can-quiet@users.calebasse.invalid');
insert into public.profiles (id, first_name, last_name, phone, global_role, notification_prefs) values
  ('00000000-0000-0000-0000-0000000000c1', 'Super', 'Admin', '770000981', 'super_admin', '{}'),
  ('00000000-0000-0000-0000-0000000000c2', 'Awa', 'Générale', '770000982', 'user', '{}'),
  ('00000000-0000-0000-0000-0000000000c3', 'Fatou', 'Militante', '770000983', 'user', '{}'),
  ('00000000-0000-0000-0000-0000000000c4', 'Modou', 'Silence', '770000984', 'user', '{"reminders": false}');

create temp table ids (k text primary key, id uuid) on commit drop;
grant all on ids to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1"}', true);
insert into ids select 'org', public.organization_save(null, 'Organisation canaux', 'OCA2', 'ocx',
  '#1A5BA8', null);
select public.organization_set_role((select id from ids where k = 'org'), '770000982', 'org_admin', true);
reset role;
select private.ensure_active_org_member((select id from ids where k = 'org'), '00000000-0000-0000-0000-0000000000c3');
select private.ensure_active_org_member((select id from ids where k = 'org'), '00000000-0000-0000-0000-0000000000c4');

-- Sans réglage : aucun SMS ni courriel (désactivés par défaut).
select private.notify('00000000-0000-0000-0000-0000000000c3', 'reminder', 'Commune', 'Cotisation due.',
  '/espace/ocx/cotisations');
select is((select count(*)::int from public.org_deliveries), 0, 'nothing is sent by SMS or email by default');

-- La militante donne son courriel ; l'administration active les deux canaux.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c3"}', true);
select throws_ok($$ select public.my_org_email_set('ocx', 'pas-un-courriel') $$, '22023', null,
  'an invalid email is refused');
select public.my_org_email_set('ocx', 'Fatou@Exemple.sn');
select is(public.my_org_email('ocx'), 'fatou@exemple.sn', 'the member saves her email');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2"}', true);
select throws_ok($$ select public.organization_settings_update('ocx', '{"reminderSms":"oui"}') $$,
  '22023', null, 'the SMS setting must be yes or no');
select public.organization_settings_update('ocx', '{"reminderSms":true,"reminderEmail":true}');
reset role;

select private.notify('00000000-0000-0000-0000-0000000000c3', 'reminder', 'Commune', 'Cotisation due.',
  '/espace/ocx/cotisations');
select is((select string_agg(channel, ',' order by channel) from public.org_deliveries), 'email,sms',
  'a reminder is queued by SMS and by email');
select private.notify('00000000-0000-0000-0000-0000000000c4', 'reminder', 'Commune', 'Cotisation due.',
  '/espace/ocx/cotisations');
select is((select count(*)::int from public.org_deliveries
  where user_id = '00000000-0000-0000-0000-0000000000c4'), 0,
  'a member who turned reminders off gets no SMS or email');
select private.notify('00000000-0000-0000-0000-0000000000c3', 'payment', 'Commune', 'Merci.',
  '/espace/ocx/historique');
select is((select count(*)::int from public.org_deliveries), 2, 'only reminders go by SMS and email');

-- Envoi : chaque envoi n'est pris qu'une fois, puis son état est noté.
select is(jsonb_array_length(public.svc_org_deliveries_claim(10)), 2, 'the sender takes the queued messages');
select is(jsonb_array_length(public.svc_org_deliveries_claim(10)), 0, 'a message is never taken twice');
select public.svc_org_delivery_done((select id from public.org_deliveries where channel = 'sms'), true, null);
select public.svc_org_delivery_done((select id from public.org_deliveries where channel = 'email'), false, 'not_configured');
select is((select string_agg(channel || ':' || status, ',' order by channel) from public.org_deliveries),
  'email:failed,sms:sent', 'the delivery status is recorded');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c3"}', true);
select throws_ok($$ select public.org_deliveries_page('ocx', 0) $$, '42501', null,
  'a member does not see the delivery log');

select * from finish();
rollback;
