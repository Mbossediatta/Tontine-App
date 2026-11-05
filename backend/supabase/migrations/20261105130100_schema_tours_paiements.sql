-- Étape 2.2 — Tours, bénéficiaires, paiements, pénalités, revenus, échanges de tour.
-- Calculs de référence : tontine-pwa/src/services/mock/lifecycle.ts (createRounds, amountBreakdown).

create type public.round_status as enum ('upcoming', 'open', 'ready_for_payout', 'paid_out');
create type public.recipient_type as enum ('members', 'platform');
create type public.payment_status as enum ('pending', 'paid', 'late', 'failed', 'refunded');
create type public.payment_method as enum ('wave', 'orange_money', 'free_money', 'cash');
create type public.earning_kind as enum ('membership_fee', 'late_penalty', 'reserved_turn');
create type public.swap_status as enum
  ('pending_partner', 'pending_admin', 'approved', 'rejected', 'cancelled');

-- ---------------------------------------------------------------------------
-- Tours
-- ---------------------------------------------------------------------------

create table public.rounds (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  cycle integer not null default 1 check (cycle >= 1),
  number integer not null check (number >= 1),
  open_date date not null,
  due_date date not null,
  -- « platform » : période finale dont la collecte revient à la plateforme.
  recipient_type public.recipient_type not null default 'members',
  pot_amount integer not null default 0 check (pot_amount >= 0),
  status public.round_status not null default 'upcoming',
  paid_out_at timestamptz,
  payout_validated_by uuid references public.profiles (id),
  -- Versement bloqué par le super admin (en cas de doute), avec le motif.
  payout_blocked_at timestamptz,
  payout_block_reason text check (char_length(btrim(payout_block_reason)) >= 4),
  created_at timestamptz not null default now(),
  constraint rounds_number_key unique (group_id, cycle, number),
  constraint rounds_dates check (due_date >= open_date),
  constraint rounds_block_reason check ((payout_blocked_at is null) = (payout_block_reason is null)),
  constraint rounds_paid_out check ((status = 'paid_out') = (paid_out_at is not null))
);

create index rounds_status_idx on public.rounds (status, due_date);

-- Bénéficiaires d'un tour : une ligne par part payée (shares_per_round parts par tour).
create table public.round_beneficiaries (
  round_id uuid not null references public.rounds (id) on delete cascade,
  membership_id uuid not null references public.memberships (id) on delete cascade,
  amount integer not null default 0 check (amount >= 0),
  primary key (round_id, membership_id)
);

create index round_beneficiaries_membership_idx on public.round_beneficiaries (membership_id);

-- ---------------------------------------------------------------------------
-- Paiements
-- ---------------------------------------------------------------------------

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete restrict,
  -- Montant destiné à la tontine = cotisation + pénalité + frais d'adhésion.
  amount integer not null check (amount > 0),
  contribution_amount integer not null default 0 check (contribution_amount >= 0),
  membership_fee_amount integer not null default 0 check (membership_fee_amount >= 0),
  late_penalty_amount integer not null default 0 check (late_penalty_amount >= 0),
  -- Frais PayTech payés par le membre en plus de « amount » ; jamais dans la cagnotte.
  service_fee_amount integer not null default 0 check (service_fee_amount >= 0),
  method public.payment_method not null,
  status public.payment_status not null default 'pending',
  -- Jeton de la demande PayTech et référence de la transaction confirmée.
  provider_token text unique,
  provider_ref text unique,
  paid_at timestamptz,
  -- Espèces : admin qui a enregistré le paiement.
  recorded_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_amount_breakdown
    check (amount = contribution_amount + membership_fee_amount + late_penalty_amount),
  constraint payments_cash_no_fee check (method <> 'cash' or service_fee_amount = 0),
  constraint payments_paid_at check ((status in ('paid', 'refunded')) = (paid_at is not null))
);

create index payments_user_idx on public.payments (user_id, created_at desc);
create index payments_round_idx on public.payments (round_id, status);
create index payments_status_idx on public.payments (status, created_at desc);

-- Au plus un paiement en cours ou réussi par personne et par tour (les échecs restent
-- dans l'historique, on peut réessayer).
create unique index payments_one_active_idx
  on public.payments (round_id, user_id) where status in ('pending', 'paid', 'late');

create trigger payments_updated_at
  before update on public.payments
  for each row execute function private.set_updated_at();

-- Pénalité de retard : une seule par personne et par tour (posée par cron-daily).
create table public.penalties (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  amount integer not null check (amount > 0),
  applied_at timestamptz not null default now(),
  constraint penalties_one_per_round unique (round_id, user_id)
);

create index penalties_user_idx on public.penalties (user_id);

-- ---------------------------------------------------------------------------
-- Revenus de la plateforme et rémunération des admins
-- ---------------------------------------------------------------------------

create table public.platform_earnings (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete restrict,
  kind public.earning_kind not null,
  amount integer not null check (amount > 0),
  payment_id uuid references public.payments (id) on delete restrict,
  round_id uuid references public.rounds (id) on delete restrict,
  user_id uuid references public.profiles (id) on delete set null,
  at timestamptz not null default now(),
  constraint platform_earnings_once_per_payment unique (payment_id, kind)
);

create index platform_earnings_group_idx on public.platform_earnings (group_id, at desc);
create index platform_earnings_at_idx on public.platform_earnings (at desc);

create table public.admin_compensations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete restrict,
  admin_id uuid not null references public.profiles (id) on delete restrict,
  amount integer not null check (amount > 0),
  note text not null default '' check (char_length(note) <= 300),
  paid_by uuid not null references public.profiles (id),
  at timestamptz not null default now()
);

create index admin_compensations_group_idx on public.admin_compensations (group_id, at desc);
create index admin_compensations_admin_idx on public.admin_compensations (admin_id);

-- ---------------------------------------------------------------------------
-- Échanges de tour : le partenaire accepte, puis un admin valide.
-- ---------------------------------------------------------------------------

create table public.swap_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  cycle integer not null check (cycle >= 1),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  partner_id uuid not null references public.profiles (id) on delete cascade,
  requester_round_id uuid not null references public.rounds (id) on delete cascade,
  partner_round_id uuid not null references public.rounds (id) on delete cascade,
  status public.swap_status not null default 'pending_partner',
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint swap_requests_distinct check (
    requester_id <> partner_id and requester_round_id <> partner_round_id
  )
);

create index swap_requests_group_idx on public.swap_requests (group_id, status);
create index swap_requests_partner_idx on public.swap_requests (partner_id, status);
create index swap_requests_requester_idx on public.swap_requests (requester_id);

alter table public.rounds enable row level security;
alter table public.round_beneficiaries enable row level security;
alter table public.payments enable row level security;
alter table public.penalties enable row level security;
alter table public.platform_earnings enable row level security;
alter table public.admin_compensations enable row level security;
alter table public.swap_requests enable row level security;
