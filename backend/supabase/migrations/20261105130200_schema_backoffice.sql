-- Étape 2.3 — Notifications, journaux, litiges, relevé PayTech, SMS, paramètres,
-- et tables privées de connexion (code SMS, PIN).

create type public.audit_action as enum (
  'group_created', 'group_updated', 'group_suspended', 'group_reactivated',
  'payout_validated', 'cash_recorded', 'admin_added', 'admin_suspended',
  'admin_reactivated', 'admin_revoked', 'settings_updated', 'login', 'group_closed',
  'group_archived', 'group_admin_changed', 'groups_reassigned', 'admin_updated',
  'admin_deleted', 'pin_reset', 'member_blocked', 'member_unblocked', 'phone_changed',
  'member_created', 'payout_blocked', 'payout_unblocked', 'dispute_updated',
  'refund_validated', 'announcement_sent', 'admin_compensated', 'community_created',
  'community_updated', 'group_community_changed'
);
create type public.security_event_kind as enum
  ('pin_failed', 'pin_blocked', 'otp_failed', 'access_denied', 'suspicious_input', 'admin_login');
create type public.security_severity as enum ('info', 'warning', 'critical');
create type public.dispute_kind as enum
  ('debited_not_recorded', 'double_payment', 'wrong_amount', 'other');
create type public.dispute_status as enum ('open', 'in_progress', 'resolved', 'rejected');
create type public.sms_kind as enum ('otp', 'reminder', 'announcement', 'payment', 'payout');

-- Journaux en ajout seul : aucune modification ni suppression.
create or replace function private.forbid_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% est en ajout seul', tg_table_name using errcode = 'insufficient_privilege';
end;
$$;

-- ---------------------------------------------------------------------------
-- Notifications et abonnements push
-- ---------------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Champ libre (added, payment, swap_request…), voir section 4.10 du cahier.
  type text not null check (char_length(type) <= 40),
  title text not null check (char_length(title) <= 120),
  body text not null check (char_length(body) <= 1000),
  -- Chemin du frontend (« /groupes/… »), jamais une adresse externe.
  link text check (link ~ '^/'),
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where not read;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- ---------------------------------------------------------------------------
-- Journal d'audit et journal de sécurité
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete set null,
  action public.audit_action not null,
  -- Phrase prête à afficher, sans le nom de l'auteur.
  summary text not null,
  group_id uuid references public.groups (id) on delete set null,
  at timestamptz not null default now()
);

create index audit_log_at_idx on public.audit_log (at desc);
create index audit_log_group_idx on public.audit_log (group_id, at desc);
create index audit_log_actor_idx on public.audit_log (actor_id, at desc);

create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function private.forbid_change();

create table public.security_events (
  id uuid primary key default gen_random_uuid(),
  kind public.security_event_kind not null,
  severity public.security_severity not null default 'info',
  detail text not null,
  user_id uuid references public.profiles (id) on delete set null,
  -- Numéro saisi quand le compte n'est pas identifié.
  phone text,
  ip inet,
  at timestamptz not null default now()
);

create index security_events_at_idx on public.security_events (at desc);
create index security_events_kind_idx on public.security_events (kind, at desc);

create trigger security_events_append_only
  before update or delete on public.security_events
  for each row execute function private.forbid_change();

-- ---------------------------------------------------------------------------
-- Litiges et remboursements
-- ---------------------------------------------------------------------------

create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  group_id uuid not null references public.groups (id) on delete restrict,
  round_id uuid references public.rounds (id) on delete set null,
  payment_id uuid references public.payments (id) on delete set null,
  provider_ref text,
  method public.payment_method,
  kind public.dispute_kind not null,
  description text not null check (char_length(btrim(description)) between 5 and 1000),
  amount integer not null check (amount >= 0),
  status public.dispute_status not null default 'open',
  refund_amount integer check (refund_amount > 0),
  refund_validated_at timestamptz,
  refund_validated_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint disputes_refund check (
    (refund_amount is null) = (refund_validated_at is null)
    and (refund_amount is null) = (refund_validated_by is null)
  )
);

create index disputes_status_idx on public.disputes (status, created_at desc);
create index disputes_user_idx on public.disputes (user_id);
create index disputes_group_idx on public.disputes (group_id);

create trigger disputes_updated_at
  before update on public.disputes
  for each row execute function private.set_updated_at();

-- Suivi d'un litige : qui a fait quoi, quand.
create table public.dispute_events (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references public.disputes (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  text text not null check (char_length(text) <= 1000),
  at timestamptz not null default now()
);

create index dispute_events_dispute_idx on public.dispute_events (dispute_id, at);

-- ---------------------------------------------------------------------------
-- Relevé du prestataire (réconciliation) et SMS envoyés
-- ---------------------------------------------------------------------------

-- Ce que PayTech a réellement encaissé (frais compris), alimenté par l'IPN et le relevé.
create table public.provider_ledger (
  ref text primary key,
  phone text,
  amount integer not null check (amount >= 0),
  at timestamptz not null,
  payment_id uuid references public.payments (id) on delete set null,
  created_at timestamptz not null default now()
);

create index provider_ledger_at_idx on public.provider_ledger (at desc);

create table public.sms_log (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  kind public.sms_kind not null,
  -- Coût facturé par Orange (FCFA), d'après sms.costPerSms au moment de l'envoi.
  cost integer not null default 0 check (cost >= 0),
  user_id uuid references public.profiles (id) on delete set null,
  at timestamptz not null default now()
);

create index sms_log_at_idx on public.sms_log (at desc);
create index sms_log_phone_idx on public.sms_log (phone, at desc);

-- ---------------------------------------------------------------------------
-- Paramètres de la plateforme : une seule ligne.
-- Les clés secrètes (PayTech, Orange) n'y sont jamais : secrets Supabase / Vault.
-- Les indices (« •••• 3f9a ») sont tenus à jour par la fonction de mise à jour.
-- ---------------------------------------------------------------------------

create table public.platform_settings (
  id boolean primary key default true check (id),
  payment jsonb not null,
  rules jsonb not null,
  security jsonb not null,
  sms jsonb not null,
  app jsonb not null,
  -- Modèles de messages en français et en wolof : {"fr": {...}, "wo": {...}}.
  templates jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

create trigger platform_settings_updated_at
  before update on public.platform_settings
  for each row execute function private.set_updated_at();

insert into public.platform_settings (payment, rules, security, sms, app, templates)
values (
  '{"provider": "PayTech", "publicKey": "", "secretKeyHint": null, "feePercent": 1.5, "mode": "test"}',
  '{"graceDays": 0, "defaultLatePenalty": 500, "minContribution": 500, "maxContribution": 500000, "maxMembers": 50}',
  '{"otpValidityMinutes": 10, "maxPinAttempts": 5, "inactivityLockMinutes": 15}',
  '{"provider": "Orange SMS API", "senderName": "CALEBASSE", "apiKeyHint": null, "costPerSms": 25}',
  jsonb_build_object(
    'name', 'Calebasse de l’Espoir',
    'supportPhone', '770100101',
    'termsText', 'En utilisant Calebasse de l’Espoir, vous vous engagez à payer vos cotisations à temps et à respecter l’ordre de passage décidé dans votre groupe.',
    'privacyText', 'Vos données (nom, numéro, paiements) servent uniquement au fonctionnement de vos tontines. Elles ne sont jamais revendues.'
  ),
  jsonb_build_object(
    'fr', jsonb_build_object(
      'reminder', 'Bonjour {prenom}, votre cotisation de {montant} pour « {groupe} » est à payer avant le {date}.',
      'late', 'Bonjour {prenom}, votre cotisation pour « {groupe} » est en retard. Montant dû : {montant}.',
      'payment', 'Merci {prenom} ! Votre paiement de {montant} pour « {groupe} » est bien reçu.',
      'payout', 'Bonne nouvelle {prenom} : la cagnotte de {montant} de « {groupe} » vous a été versée.'
    ),
    -- Wolof : à relire par un locuteur avant tout envoi réel (point ouvert du cahier).
    'wo', jsonb_build_object(
      'reminder', 'Salaam {prenom}, sa cotisation bu {montant} ci « {groupe} » war na fay ba {date}.',
      'late', 'Salaam {prenom}, sa cotisation ci « {groupe} » dafa yéex. Lu nga war a fay : {montant}.',
      'payment', 'Jërëjëf {prenom} ! Sa fay bu {montant} ci « {groupe} » agsi na.',
      'payout', 'Xibaar bu baax {prenom} : cagnotte bu {montant} bu « {groupe} » yónnee nañu la ko.'
    )
  )
);

-- ---------------------------------------------------------------------------
-- Connexion (schéma privé, accès service_role uniquement) — voir section 4.1.
-- ---------------------------------------------------------------------------

-- Codes SMS : on ne garde que l'empreinte HMAC (OTP_PEPPER), jamais le code.
create table private.auth_otps (
  id uuid primary key default gen_random_uuid(),
  phone text not null check (phone ~ '^7[0-9]{8}$'),
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  used_at timestamptz,
  ip inet,
  created_at timestamptz not null default now()
);

create index auth_otps_phone_idx on private.auth_otps (phone, created_at desc);
create index auth_otps_ip_idx on private.auth_otps (ip, created_at desc);

-- PIN : empreinte Argon2id (avec PIN_PEPPER) et compteur d'essais.
create table private.auth_pins (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  pin_hash text,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  -- Vrai après trop d'erreurs ou une remise à zéro par le super admin : seul le SMS débloque.
  must_reset boolean not null default false,
  updated_at timestamptz not null default now()
);

create trigger auth_pins_updated_at
  before update on private.auth_pins
  for each row execute function private.set_updated_at();

grant usage on schema private to service_role;
grant select, insert, update, delete on all tables in schema private to service_role;

alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.audit_log enable row level security;
alter table public.security_events enable row level security;
alter table public.disputes enable row level security;
alter table public.dispute_events enable row level security;
alter table public.provider_ledger enable row level security;
alter table public.sms_log enable row level security;
alter table public.platform_settings enable row level security;
