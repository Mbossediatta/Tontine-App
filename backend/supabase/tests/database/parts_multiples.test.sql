begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f2', 'pm-admin@users.calebasse.invalid');
insert into public.profiles (id, first_name, last_name, phone, global_role) values
  ('00000000-0000-0000-0000-0000000000f2', 'Moussa', 'Diop', '770000972', 'admin');
insert into public.communities (id, name) values ('00000000-0000-0000-0000-0000000000fc', 'Test parts');
insert into public.community_admins (community_id, admin_id)
values ('00000000-0000-0000-0000-0000000000fc', '00000000-0000-0000-0000-0000000000f2');

create temp table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000f2')::text, true);

-- 5 parts, 2 par tour : le dernier tour n'aurait qu'un bénéficiaire, refusé.
select throws_like(
  $$select public.group_create(jsonb_build_object(
    'name', 'Tontine bancale', 'contributionAmount', 1000, 'frequency', 'daily', 'turnLength', 3,
    'sharesPerRound', 2, 'maxMembers', 5, 'paymentDueDay', 1,
    'startDate', (current_date + 10)::text))$$,
  'Avec 2 parts par tour, le nombre total de parts doit être un multiple de 2 (4 ou 6)%',
  'création refusée quand les parts ne tombent pas juste');

-- 6 parts, 2 par tour : accepté.
insert into ids select 'g', public.group_create(jsonb_build_object(
  'name', 'Tontine juste', 'contributionAmount', 1000, 'frequency', 'daily', 'turnLength', 3,
  'sharesPerRound', 2, 'maxMembers', 6, 'paymentDueDay', 1,
  'startDate', (current_date + 10)::text));
select isnt((select id from ids where name = 'g'), null, 'création acceptée avec 6 parts');

select throws_like(
  format($$select public.group_update(%L, '{"maxMembers": 7}')$$, (select id from ids where name = 'g')),
  'Avec 2 parts par tour%multiple de 2 (6 ou 8)%',
  'passer à 7 parts est refusé');

select throws_like(
  format($$select public.group_update(%L, '{"sharesPerRound": 4}')$$, (select id from ids where name = 'g')),
  'Avec 4 parts par tour%multiple de 4 (4 ou 8)%',
  'passer à 4 parts par tour est refusé');

select lives_ok(
  format($$select public.group_update(%L, '{"maxMembers": 9, "sharesPerRound": 3}')$$,
    (select id from ids where name = 'g')),
  'changer les deux à la fois pour tomber juste est accepté');

select * from finish();
rollback;
