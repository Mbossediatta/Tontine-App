begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

-- Même compte dans une tontine Calebasse et dans une organisation : notifications séparées.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'e-awa@users.calebasse.invalid');
insert into public.profiles (id, first_name, last_name, phone, global_role) values
  ('00000000-0000-0000-0000-0000000000e1', 'Awa', 'Ndiaye', '770000981', 'user');

select private.notify('00000000-0000-0000-0000-0000000000e1', 'reminder', 'Tontine',
  'Votre cotisation est due demain.', '/groupes/g-1');
select private.notify('00000000-0000-0000-0000-0000000000e1', 'organization', 'AFP',
  'Votre adhésion est validée.', null);
select private.notify('00000000-0000-0000-0000-0000000000e1', 'reminder', 'AFP – Jeunes',
  'Votre cotisation est due demain.', '/espace/afp/cotisations');
select private.notify('00000000-0000-0000-0000-0000000000e1', 'payment', 'Espace membre',
  'Paiement reçu.', '/espace-membre');

select is((select app from public.notifications where user_id = '00000000-0000-0000-0000-0000000000e1' and link = '/groupes/g-1'), 'calebasse',
  'a tontine reminder stays in Calebasse');
select is((select app from public.notifications where user_id = '00000000-0000-0000-0000-0000000000e1' and type = 'organization'), 'org',
  'an organization notification goes to the organization app');
select is((select app from public.notifications where user_id = '00000000-0000-0000-0000-0000000000e1' and link = '/espace/afp/cotisations'), 'org',
  'an organization dues reminder goes to the organization app');
select is((select app from public.notifications where user_id = '00000000-0000-0000-0000-0000000000e1' and link = '/espace-membre'), 'calebasse',
  'the Calebasse member space is not mistaken for an organization space');
select is((select count(*)::int from public.notifications
           where user_id = '00000000-0000-0000-0000-0000000000e1' and app = 'calebasse'), 2,
  'Calebasse shows only its own notifications');

select * from finish();
rollback;
