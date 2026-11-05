-- Étape 2.1 — Types, comptes, communautés, groupes, adhésions.
-- Référence : tontine-pwa/src/types/index.ts et docs/CAHIER-DES-CHARGES-INTEGRATION.md (section 4).
-- Montants : entiers en FCFA. Numéros : 9 chiffres commençant par 7 (sans +221).
-- Les règles RLS arrivent à l'étape 3 : en attendant, chaque table a RLS activé sans
-- politique, donc rien n'est lisible avec la clé publique.

create extension if not exists pgcrypto with schema extensions;

-- Schéma privé : jamais exposé par l'API (PIN, codes SMS, fonctions internes).
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Types énumérés
-- ---------------------------------------------------------------------------

create type public.global_role as enum ('super_admin', 'admin', 'user');
create type public.group_role as enum ('owner', 'co_admin', 'member');
create type public.frequency as enum ('weekly', 'biweekly', 'monthly');
create type public.group_status as enum ('draft', 'active', 'finished', 'suspended');
create type public.attribution_mode as enum ('random', 'manual');
create type public.join_policy as enum ('invite', 'community');
create type public.status_visibility as enum ('members', 'admins');
create type public.membership_status as enum ('pending', 'active', 'removed');
create type public.payout_method as enum ('wave', 'orange_money');
create type public.app_language as enum ('fr', 'wo');

-- ---------------------------------------------------------------------------
-- Fonctions utilitaires
-- ---------------------------------------------------------------------------

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Code d'invitation de 6 caractères, sans caractères ambigus (0/O, 1/I/L).
create or replace function private.random_invite_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  bytes bytea := extensions.gen_random_bytes(6);
  code text := '';
begin
  for i in 0..5 loop
    code := code || substr(alphabet, 1 + (get_byte(bytes, i) % length(alphabet)), 1);
  end loop;
  return code;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profils (un par compte Supabase Auth)
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text not null check (char_length(first_name) between 2 and 40),
  last_name text not null check (char_length(last_name) between 2 and 40),
  -- Vidé quand le compte est supprimé (données anonymisées).
  phone text unique check (phone ~ '^7[0-9]{8}$'),
  avatar_url text,
  global_role public.global_role not null default 'user',
  is_suspended boolean not null default false,
  payout_phone text check (payout_phone ~ '^7[0-9]{8}$'),
  payout_method public.payout_method,
  -- Langue de l'espace membre, des SMS et des notifications du membre.
  language public.app_language not null default 'fr',
  notification_prefs jsonb not null
    default '{"reminders": true, "payments": true, "beneficiary": true}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_phone_required check (phone is not null or deleted_at is not null)
);

create index profiles_global_role_idx on public.profiles (global_role) where global_role <> 'user';

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Communautés
-- ---------------------------------------------------------------------------

create table public.communities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 60),
  description text check (char_length(description) <= 300),
  created_at timestamptz not null default now()
);

create unique index communities_name_key on public.communities (lower(btrim(name)));

-- Un admin peut gérer plusieurs communautés ; être admin d'une communauté ne donne
-- aucun droit sur ses groupes (voir groups.admin_id).
create table public.community_admins (
  community_id uuid not null references public.communities (id) on delete cascade,
  admin_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (community_id, admin_id)
);

create index community_admins_admin_idx on public.community_admins (admin_id);

-- ---------------------------------------------------------------------------
-- Groupes
-- ---------------------------------------------------------------------------

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  community_id uuid references public.communities (id) on delete set null,
  join_policy public.join_policy not null default 'invite',
  name text not null check (char_length(btrim(name)) between 3 and 50),
  description text check (char_length(description) <= 300),
  -- Montant par part et par période (ou par jour si daily_contribution).
  contribution_amount integer not null check (contribution_amount >= 500),
  daily_contribution boolean not null default false,
  turn_duration_days integer not null default 10 check (turn_duration_days between 1 and 90),
  shares_per_round integer not null default 1 check (shares_per_round >= 1),
  -- Frais d'adhésion facturés une seule fois par personne (0 = aucun).
  membership_fee_amount integer not null default 0 check (membership_fee_amount >= 0),
  -- Dernière période de collecte réservée à la plateforme.
  reserve_final_turn boolean not null default false,
  frequency public.frequency not null,
  -- Nombre total de parts (une personne peut en avoir plusieurs). Plafond réel :
  -- platform_settings.rules.maxMembers, vérifié par les fonctions.
  max_members integer not null check (max_members between 2 and 500),
  payment_due_day integer not null check (payment_due_day between 1 and 28),
  start_date date not null,
  attribution_mode public.attribution_mode not null default 'random',
  late_penalty integer check (late_penalty >= 0),
  status public.group_status not null default 'draft',
  invite_code text not null unique check (invite_code ~ '^[A-Z0-9]{4,12}$'),
  created_by uuid not null references public.profiles (id),
  -- Administrateur responsable : gère le groupe sans forcément y cotiser.
  admin_id uuid not null references public.profiles (id),
  member_status_visibility public.status_visibility not null default 'members',
  current_cycle integer not null default 1 check (current_cycle >= 1),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint groups_shares_per_round_max check (shares_per_round <= max_members),
  constraint groups_archived_when_finished check (archived_at is null or status = 'finished')
);

create index groups_community_idx on public.groups (community_id);
create index groups_admin_idx on public.groups (admin_id);
create index groups_created_by_idx on public.groups (created_by);
create index groups_status_idx on public.groups (status) where archived_at is null;

create or replace function private.groups_default_invite_code()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  candidate text;
begin
  if new.invite_code is null then
    loop
      candidate := private.random_invite_code();
      exit when not exists (select 1 from public.groups where invite_code = candidate);
    end loop;
    new.invite_code := candidate;
  else
    new.invite_code := upper(btrim(new.invite_code));
  end if;
  return new;
end;
$$;

create trigger groups_invite_code
  before insert on public.groups
  for each row execute function private.groups_default_invite_code();

create trigger groups_updated_at
  before update on public.groups
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Adhésions : une ligne par part (plusieurs parts possibles pour une personne).
-- Une demande d'adhésion = une ligne « pending ».
-- ---------------------------------------------------------------------------

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.group_role not null default 'member',
  status public.membership_status not null default 'pending',
  payout_order integer check (payout_order >= 1),
  joined_at timestamptz not null default now(),
  -- Différée : permet d'échanger deux rangs dans une même transaction.
  constraint memberships_payout_order_key unique (group_id, payout_order)
    deferrable initially deferred,
  constraint memberships_order_only_active check (payout_order is null or status = 'active')
);

create index memberships_user_idx on public.memberships (user_id);
create index memberships_group_status_idx on public.memberships (group_id, status);

-- Une seule demande en attente par personne et par groupe.
create unique index memberships_one_pending_idx
  on public.memberships (group_id, user_id) where status = 'pending';

-- ---------------------------------------------------------------------------
-- RLS activé partout ; les politiques arrivent à l'étape 3.
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.communities enable row level security;
alter table public.community_admins enable row level security;
alter table public.groups enable row level security;
alter table public.memberships enable row level security;
