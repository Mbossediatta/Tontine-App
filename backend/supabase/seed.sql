-- Données de démonstration (local et projet de test uniquement, jamais en production).
-- Base volontairement minimale (demande du 2026-11-05) : trois comptes seulement, un par rôle.
-- Communautés, groupes, membres et paiements sont créés à la main depuis l'application.
--
-- Aucun PIN n'est créé ici : les empreintes dépendent du poivre secret (PIN_PEPPER).
-- Pour se connecter : numéro → code SMS (affiché dans les journaux de la fonction avec
-- SMS_MODE=console) → création du PIN.
-- Le mot de passe interne Supabase Auth est remis à la bonne valeur à la première
-- ouverture de session (voir openSession dans functions/_shared/db.ts).

create temporary table demo_users (
  id uuid, first_name text, last_name text, phone text,
  global_role public.global_role, payout_method public.payout_method, months_ago integer
);

insert into demo_users values
  ('a0000000-0000-0000-0000-000000000001', 'Aminata', 'Sow', '776502698', 'super_admin', null, 6),
  ('a0000000-0000-0000-0000-000000000002', 'Moussa', 'Diop', '771234567', 'admin', 'wave', 6),
  ('a0000000-0000-0000-0000-000000000011', 'Awa', 'Fall', '772345678', 'user', 'wave', 6);

-- Comptes Supabase Auth : e-mail technique, mot de passe aléatoire (remplacé à la
-- première connexion par le mot de passe interne).
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated',
  id || '@users.calebasse.invalid',
  extensions.crypt(encode(extensions.gen_random_bytes(32), 'hex'), extensions.gen_salt('bf')),
  now(), '{"provider": "email", "providers": ["email"]}', '{}', now(), now(), '', '', '', ''
from demo_users;

insert into auth.identities (
  id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(), id, id::text, 'email',
  jsonb_build_object('sub', id::text, 'email', id || '@users.calebasse.invalid', 'email_verified', true),
  now(), now(), now()
from demo_users;

insert into public.profiles (
  id, first_name, last_name, phone, global_role, payout_phone, payout_method, created_at
)
select
  id, first_name, last_name, phone, global_role,
  case when payout_method is not null then phone end, payout_method,
  case when months_ago = 0 then date_trunc('month', now()) else now() - make_interval(months => months_ago) end
from demo_users;

drop table demo_users;
