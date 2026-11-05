begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'c-super@users.calebasse.invalid'),
  ('00000000-0000-0000-0000-0000000000c2', 'c-awa@users.calebasse.invalid');
insert into public.profiles (id, first_name, last_name, phone, global_role) values
  ('00000000-0000-0000-0000-0000000000c1', 'Super', 'Admin', '770000971', 'super_admin'),
  ('00000000-0000-0000-0000-0000000000c2', 'Awa', 'Fall', '770000972', 'user');

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p)::text, true);
$$;

create temp table v (n integer) on commit drop;
grant all on v to authenticated, anon;
insert into v select (public.legal_terms() ->> 'version')::int;

-- --- Lecture sans session ----------------------------------------------------------
set local role anon;
select is((public.legal_terms() ->> 'version')::int, (select n from v),
  'anyone can read the legal texts and their version');
select ok(public.legal_terms() ->> 'termsText' is not null, 'the terms text is returned');

-- --- Acceptation par la personne connectée ------------------------------------------
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select is((public.terms_status() -> 'accepted'), 'null'::jsonb, 'a new account has accepted nothing');
select throws_ok(format('select public.terms_accept(%s)', (select n from v) + 5), '23505', null,
  'an outdated or future version is refused');
select lives_ok(format('select public.terms_accept(%s, %L)', (select n from v), 'Test UA'),
  'the current version can be accepted');
select is((public.terms_status() ->> 'accepted')::int, (select n from v), 'status shows it as accepted');
select is((select count(*)::int from public.terms_acceptances), 1, 'the person sees her own proof only');
select throws_ok(
  $$update public.profiles set terms_version = 99
    where id = '00000000-0000-0000-0000-0000000000c2'$$,
  '42501', null, 'the accepted version cannot be written directly');

-- --- Preuve en ajout seul -----------------------------------------------------------
reset role;
select throws_ok($$update public.terms_acceptances set version = 1$$, '42501', null,
  'proofs cannot be modified');

-- --- Textes modifiés : nouvelle version ---------------------------------------------
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select public.settings_update('app', public.settings_get() -> 'app')$$,
  'saving the same texts');
select is((public.legal_terms() ->> 'version')::int, (select n from v),
  'unchanged texts keep the version');
select lives_ok(
  $$select public.settings_update('app',
      jsonb_set(public.settings_get() -> 'app', '{termsText}', '"Nouvelles conditions de test."'))$$,
  'changing the terms text');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select isnt((public.terms_status() ->> 'current')::int, (public.terms_status() ->> 'accepted')::int,
  'a changed text must be accepted again');

select * from finish();
rollback;
