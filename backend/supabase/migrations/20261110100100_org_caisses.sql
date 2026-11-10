-- Organisations, étape 2 : caisses de cotisation des structures (ex. AFP).
--
-- Une caisse appartient à une structure : frais d'adhésion, cotisation périodique,
-- cotisation exceptionnelle ou contributions volontaires. Les échéances de chaque
-- militant actif de la structure sont créées automatiquement (une échéance à venir
-- d'avance). Pas de tour ni de bénéficiaire : l'argent reste dans la caisse.
--
-- Règles :
-- - un retard est enregistré mais n'entraîne aucune pénalité ; un paiement tardif
--   régularise l'échéance sans effacer le retard (payée le … après la date due) ;
-- - les paiements sont saisis par le trésorier ou le responsable (espèces, virement…) ;
--   le paiement en ligne viendra quand le compte de paiement de l'organisation sera choisi ;
-- - un paiement n'est jamais supprimé : il est annulé (par l'admin général ou
--   financier, pas par celui qui l'a saisi), avec motif, et reste dans l'historique ;
-- - changer le montant d'une caisse ne touche que les échéances à venir non payées ;
-- - une exemption est autorisée et justifiée ;
-- - le super admin ne voit que les totaux de l'organisation.
-- Fonds commun et répartition : étape suivante.

alter type public.audit_action add value if not exists 'org_fund_saved';
alter type public.audit_action add value if not exists 'org_payment_recorded';
alter type public.audit_action add value if not exists 'org_payment_cancelled';
alter type public.audit_action add value if not exists 'org_installment_exempted';

create type public.org_fund_kind as enum ('adhesion', 'cotisation', 'exceptionnelle', 'volontaire');
create type public.org_fund_frequency as enum ('once', 'monthly', 'quarterly', 'yearly');
create type public.org_payment_method as enum ('cash', 'wave', 'orange_money', 'virement', 'autre');

alter table public.organizations
  add column next_receipt_number integer not null default 1 check (next_receipt_number >= 1);

create table public.org_funds (
  id uuid primary key default gen_random_uuid(),
  structure_id uuid not null references public.org_structures (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 3 and 80),
  kind public.org_fund_kind not null,
  -- Montant par échéance, en FCFA (0 pour les contributions volontaires).
  amount integer not null check (amount between 0 and 10000000),
  frequency public.org_fund_frequency not null,
  start_date date not null,
  due_day integer not null default 5 check (due_day between 1 and 28),
  end_date date,
  is_closed boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint org_funds_amount_kind check ((kind = 'volontaire') = (amount = 0)),
  constraint org_funds_amount_min check (kind = 'volontaire' or amount >= 100),
  constraint org_funds_once check (kind not in ('adhesion', 'exceptionnelle', 'volontaire') or frequency = 'once'),
  constraint org_funds_end check (end_date is null or end_date >= start_date)
);

create index org_funds_structure_idx on public.org_funds (structure_id);

create trigger org_funds_updated_at
  before update on public.org_funds
  for each row execute function private.set_updated_at();

create table public.org_installments (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.org_funds (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  due_date date not null,
  amount_due integer not null check (amount_due > 0),
  amount_paid integer not null default 0 check (amount_paid >= 0),
  -- Moment où l'échéance a été soldée (retard : paid_at après due_date).
  paid_at timestamptz,
  exempted_at timestamptz,
  exempted_by uuid references public.profiles (id) on delete set null,
  exemption_reason text check (char_length(exemption_reason) <= 200),
  created_at timestamptz not null default now(),
  unique (fund_id, user_id, due_date),
  constraint org_installments_not_over check (amount_paid <= amount_due)
);

create index org_installments_user_idx on public.org_installments (user_id, due_date);
create index org_installments_fund_idx on public.org_installments (fund_id, due_date);

create table public.org_payments (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.org_funds (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete restrict,
  amount integer not null check (amount > 0),
  method public.org_payment_method not null,
  reference text check (char_length(reference) <= 80),
  receipt_number text not null unique,
  recorded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id) on delete set null,
  cancel_reason text check (char_length(cancel_reason) <= 200)
);

create index org_payments_fund_idx on public.org_payments (fund_id, created_at desc);
create index org_payments_user_idx on public.org_payments (user_id, created_at desc);

create table public.org_payment_allocations (
  payment_id uuid not null references public.org_payments (id) on delete restrict,
  installment_id uuid not null references public.org_installments (id) on delete restrict,
  amount integer not null check (amount > 0),
  primary key (payment_id, installment_id)
);

create index org_payment_allocations_installment_idx
  on public.org_payment_allocations (installment_id);

-- Rappels déjà envoyés (une fois par échéance et par décalage J-2, J0, J+3, J+7).
create table public.org_reminders (
  installment_id uuid not null references public.org_installments (id) on delete cascade,
  offset_days integer not null,
  sent_at timestamptz not null default now(),
  primary key (installment_id, offset_days)
);

alter table public.org_funds enable row level security;
alter table public.org_installments enable row level security;
alter table public.org_payments enable row level security;
alter table public.org_payment_allocations enable row level security;
alter table public.org_reminders enable row level security;
revoke all on public.org_funds, public.org_installments, public.org_payments,
  public.org_payment_allocations, public.org_reminders from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Droits sur l'argent
-- ---------------------------------------------------------------------------

-- Saisir des paiements, créer des caisses, exempter : admin général ou financier, ou
-- responsable ou trésorier de la structure (ou d'une structure dont elle dépend).
create or replace function private.handles_structure_money(p_structure uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.active_uid() is not null and (
    exists (
      select 1 from public.org_structures s
      where s.id = p_structure
        and private.has_org_role(s.organization_id,
              array['org_admin', 'finance_admin']::public.org_role[])
    )
    or exists (
      select 1 from public.structure_roles r
      where r.user_id = private.active_uid() and r.role in ('responsable', 'tresorier')
        and r.structure_id in (select a.id from private.structure_ancestors(p_structure) a)
    )
  )
$$;

-- Consulter les caisses : ceux qui gèrent la structure, plus les rôles financiers de
-- l'organisation (contrôleur compris).
create or replace function private.views_structure_money(p_structure uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.manages_structure(p_structure) or exists (
    select 1 from public.org_structures s
    where s.id = p_structure
      and private.has_org_role(s.organization_id,
            array['org_admin', 'finance_admin', 'controller']::public.org_role[])
  )
$$;

create or replace function private.require_fund(p_fund uuid)
returns public.org_funds
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f public.org_funds;
begin
  select * into f from public.org_funds where id = p_fund;
  if not found then
    raise exception 'Cette caisse est introuvable.' using errcode = 'P0002';
  end if;
  return f;
end;
$$;

create or replace function private.require_money_rights(p_structure uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
begin
  if not private.handles_structure_money(p_structure) then
    raise exception 'Réservé au responsable, au trésorier ou à l’administration financière.'
      using errcode = '42501', hint = 'access_denied:structure_money';
  end if;
  return uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Échéances
-- ---------------------------------------------------------------------------

create or replace function private.org_step_months(p_frequency public.org_fund_frequency)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_frequency when 'monthly' then 1 when 'quarterly' then 3 when 'yearly' then 12
    else 0 end
$$;

-- Crée les échéances manquantes d'une caisse pour ses militants actifs, jusqu'à la
-- première échéance à venir. Retire les échéances futures non payées des militants
-- sortis de la structure.
create or replace function private.org_generate_installments(p_fund uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.org_funds;
  m record;
  step integer;
  first_due date;
  due date;
  guard integer;
begin
  select * into f from public.org_funds where id = p_fund;
  if not found or f.kind = 'volontaire' then
    return;
  end if;
  step := private.org_step_months(f.frequency);

  -- Sortis de la structure : leurs échéances futures non entamées disparaissent.
  delete from public.org_installments i
  where i.fund_id = f.id and i.amount_paid = 0 and i.due_date > current_date
    and not exists (
      select 1 from public.structure_members sm
      where sm.structure_id = f.structure_id and sm.user_id = i.user_id and sm.status = 'active'
    )
    and not exists (select 1 from public.org_payment_allocations a where a.installment_id = i.id);

  if f.is_closed then
    return;
  end if;

  for m in
    select sm.user_id, coalesce(sm.decided_at, sm.requested_at)::date as since
    from public.structure_members sm
    where sm.structure_id = f.structure_id and sm.status = 'active'
  loop
    if f.frequency = 'once' then
      due := greatest(f.start_date, m.since);
      if f.end_date is null or due <= f.end_date then
        insert into public.org_installments (fund_id, user_id, due_date, amount_due)
        values (f.id, m.user_id, due, f.amount)
        on conflict do nothing;
      end if;
      continue;
    end if;

    -- Première date due (jour fixé) à partir du début de la caisse et de l'arrivée.
    first_due := make_date(extract(year from f.start_date)::int,
                           extract(month from f.start_date)::int, f.due_day);
    if first_due < f.start_date then
      first_due := (first_due + make_interval(months => step))::date;
    end if;
    due := first_due;
    guard := 0;
    while due < m.since and guard < 600 loop
      due := (due + make_interval(months => step))::date;
      guard := guard + 1;
    end loop;

    -- Jusqu'à la première échéance qui n'est pas encore passée (incluse).
    guard := 0;
    loop
      exit when f.end_date is not null and due > f.end_date;
      insert into public.org_installments (fund_id, user_id, due_date, amount_due)
      values (f.id, m.user_id, due, f.amount)
      on conflict do nothing;
      exit when due >= current_date;
      due := (due + make_interval(months => step))::date;
      guard := guard + 1;
      exit when guard > 600;
    end loop;
  end loop;
end;
$$;

create or replace function private.org_generate_structure(p_structure uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fund uuid;
begin
  for v_fund in select f.id from public.org_funds f where f.structure_id = p_structure loop
    perform private.org_generate_installments(v_fund);
  end loop;
end;
$$;

-- Tâche quotidienne : prochaines échéances de toutes les caisses ouvertes.
create or replace function private.org_generate_all()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fund uuid;
begin
  for v_fund in
    select f.id from public.org_funds f
    join public.org_structures s on s.id = f.structure_id
    join public.organizations o on o.id = s.organization_id
    where not f.is_closed and s.status <> 'archived' and not o.is_suspended
  loop
    perform private.org_generate_installments(v_fund);
  end loop;
end;
$$;

-- Statut d'une échéance : exempted, paid, partial, upcoming (pas encore due), late.
create or replace function private.org_installment_status(i public.org_installments)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when i.exempted_at is not null then 'exempted'
    when i.amount_paid >= i.amount_due then 'paid'
    when i.amount_paid > 0 then 'partial'
    when i.due_date >= current_date then 'upcoming'
    else 'late'
  end
$$;

create or replace function private.org_installment_json(i public.org_installments)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', i.id, 'fundId', i.fund_id, 'dueDate', i.due_date,
    'amountDue', i.amount_due, 'amountPaid', i.amount_paid,
    'status', private.org_installment_status(i),
    'paidAt', i.paid_at,
    'paidLate', i.paid_at is not null and i.paid_at::date > i.due_date,
    'exemptionReason', i.exemption_reason
  )
$$;

create or replace function private.org_fund_json(f public.org_funds)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', f.id, 'structureId', f.structure_id, 'name', f.name, 'kind', f.kind,
    'amount', f.amount, 'frequency', f.frequency, 'startDate', f.start_date,
    'dueDay', f.due_day, 'endDate', f.end_date, 'isClosed', f.is_closed,
    'createdAt', f.created_at,
    -- Attendu : échéances arrivées à terme (non exemptées) ; encaissé : paiements valides.
    'expected', coalesce((
      select sum(i.amount_due) from public.org_installments i
      where i.fund_id = f.id and i.exempted_at is null and i.due_date <= current_date), 0),
    'collected', coalesce((
      select sum(p.amount) from public.org_payments p
      where p.fund_id = f.id and p.cancelled_at is null), 0),
    'remaining', coalesce((
      select sum(i.amount_due - i.amount_paid) from public.org_installments i
      where i.fund_id = f.id and i.exempted_at is null and i.due_date < current_date), 0),
    'lateMembers', (
      select count(distinct i.user_id) from public.org_installments i
      where i.fund_id = f.id and i.exempted_at is null and i.due_date < current_date
        and i.amount_paid < i.amount_due)
  )
$$;

-- ---------------------------------------------------------------------------
-- Caisses
-- ---------------------------------------------------------------------------

create or replace function public.org_fund_save(
  p_structure uuid,
  p_id uuid,
  p_name text,
  p_kind public.org_fund_kind,
  p_amount integer,
  p_frequency public.org_fund_frequency,
  p_start_date date,
  p_due_day integer,
  p_end_date date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.org_structures := private.require_structure(p_structure);
  uid uuid := private.require_money_rights(s.id);
  clean_name text := btrim(coalesce(p_name, ''));
  v_frequency public.org_fund_frequency :=
    case when p_kind in ('adhesion', 'exceptionnelle', 'volontaire') then 'once' else p_frequency end;
  v_amount integer := case when p_kind = 'volontaire' then 0 else coalesce(p_amount, 0) end;
  saved_id uuid := p_id;
  previous public.org_funds;
begin
  perform private.inspect_input('name', clean_name);
  if char_length(clean_name) not between 3 and 80 then
    raise exception 'Le nom doit contenir entre 3 et 80 caractères.' using errcode = '22023';
  end if;
  if p_kind <> 'volontaire' and v_amount < 100 then
    raise exception 'Le montant doit être d’au moins 100 FCFA.' using errcode = '22023';
  end if;
  if v_amount > 10000000 then
    raise exception 'Montant trop élevé.' using errcode = '22023';
  end if;
  if p_kind = 'cotisation' and v_frequency = 'once' then
    raise exception 'Choisissez la périodicité de la cotisation.' using errcode = '22023';
  end if;
  if p_start_date is null then
    raise exception 'Indiquez la date de début.' using errcode = '22023';
  end if;
  if p_end_date is not null and p_end_date < p_start_date then
    raise exception 'La date de fin doit suivre la date de début.' using errcode = '22023';
  end if;
  if coalesce(p_due_day, 5) not between 1 and 28 then
    raise exception 'Le jour d’échéance doit être entre 1 et 28.' using errcode = '22023';
  end if;
  if s.status = 'archived' then
    raise exception 'Cette structure est archivée.' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.org_funds (structure_id, name, kind, amount, frequency, start_date,
      due_day, end_date, created_by)
    values (s.id, clean_name, p_kind, v_amount, v_frequency, p_start_date, coalesce(p_due_day, 5),
      p_end_date, uid)
    returning id into saved_id;
  else
    select * into previous from public.org_funds where id = p_id and structure_id = s.id;
    if not found then
      raise exception 'Cette caisse est introuvable.' using errcode = 'P0002';
    end if;
    if previous.kind <> p_kind then
      raise exception 'Le type d’une caisse ne change pas : créez-en une autre.' using errcode = '22023';
    end if;
    -- Les échéances déjà créées gardent leurs dates ; seul le montant des échéances à
    -- venir non entamées suit le nouveau montant.
    update public.org_funds
    set name = clean_name, amount = v_amount, end_date = p_end_date,
        frequency = case when exists (select 1 from public.org_installments i where i.fund_id = p_id)
                         then previous.frequency else v_frequency end,
        start_date = case when exists (select 1 from public.org_installments i where i.fund_id = p_id)
                          then previous.start_date else p_start_date end,
        due_day = case when exists (select 1 from public.org_installments i where i.fund_id = p_id)
                       then previous.due_day else coalesce(p_due_day, 5) end
    where id = p_id;
    update public.org_installments i
    set amount_due = v_amount
    where i.fund_id = p_id and i.due_date > current_date and i.amount_paid = 0
      and i.exempted_at is null and v_amount > 0;
    -- Fin avancée : les échéances non entamées après la fin disparaissent.
    if p_end_date is not null then
      delete from public.org_installments i
      where i.fund_id = p_id and i.due_date > p_end_date and i.amount_paid = 0
        and not exists (select 1 from public.org_payment_allocations a where a.installment_id = i.id);
    end if;
  end if;

  perform private.org_generate_installments(saved_id);
  perform private.audit(uid, 'org_fund_saved',
    format(case when p_id is null then 'a créé la caisse « %s » de « %s »'
                else 'a modifié la caisse « %s » de « %s »' end, clean_name, s.name));
  return saved_id;
end;
$$;

create or replace function public.org_fund_close(p_fund uuid, p_closed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.org_funds := private.require_fund(p_fund);
  uid uuid := private.require_money_rights(f.structure_id);
begin
  update public.org_funds set is_closed = coalesce(p_closed, true) where id = f.id;
  if coalesce(p_closed, true) then
    -- Plus d'échéances futures non entamées.
    delete from public.org_installments i
    where i.fund_id = f.id and i.due_date > current_date and i.amount_paid = 0
      and not exists (select 1 from public.org_payment_allocations a where a.installment_id = i.id);
  else
    perform private.org_generate_installments(f.id);
  end if;
  perform private.audit(uid, 'org_fund_saved',
    format('a %s la caisse « %s »', case when coalesce(p_closed, true) then 'clôturé' else 'rouvert' end,
      f.name));
end;
$$;

-- Caisses d'une structure, avec leurs totaux.
create or replace function public.structure_funds(p_structure uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.org_structures := private.require_structure(p_structure);
begin
  perform private.require_uid();
  if not private.views_structure_money(s.id) then
    raise exception 'Vous ne gérez pas cette structure.'
      using errcode = '42501', hint = 'access_denied:structure';
  end if;
  return jsonb_build_object(
    'canHandleMoney', private.handles_structure_money(s.id),
    'funds', coalesce((
      select jsonb_agg(private.org_fund_json(f) order by f.is_closed, f.created_at)
      from public.org_funds f where f.structure_id = s.id
    ), '[]'::jsonb)
  );
end;
$$;

-- Une caisse : militants et leurs échéances de l'année, paiements récents.
create or replace function public.org_fund_view(p_fund uuid, p_year integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.org_funds := private.require_fund(p_fund);
  s public.org_structures := private.require_structure(f.structure_id);
  o public.organizations := private.require_organization(s.organization_id);
  year_start date := make_date(coalesce(p_year, extract(year from current_date)::int), 1, 1);
  year_end date := make_date(coalesce(p_year, extract(year from current_date)::int), 12, 31);
begin
  perform private.require_uid();
  if not private.views_structure_money(s.id) then
    raise exception 'Vous ne gérez pas cette structure.'
      using errcode = '42501', hint = 'access_denied:structure';
  end if;
  -- Les échéances du jour sont à jour avant l'affichage.
  perform private.org_generate_installments(f.id);

  return jsonb_build_object(
    'organization', private.org_json(o),
    'structure', jsonb_build_object('id', s.id, 'name', s.name),
    'fund', private.org_fund_json(f),
    'canHandleMoney', private.handles_structure_money(s.id),
    'canCancel', private.has_org_role(o.id, array['org_admin', 'finance_admin']::public.org_role[]),
    'year', extract(year from year_start)::int,
    'members', coalesce((
      select jsonb_agg(x.member order by x.sort_name)
      from (
        select lower(p.last_name || ' ' || p.first_name) as sort_name,
          jsonb_build_object(
            'userId', p.id, 'firstName', p.first_name, 'lastName', p.last_name,
            'phone', p.phone, 'memberNumber', om.member_number,
            'active', exists (select 1 from public.structure_members sm
                              where sm.structure_id = s.id and sm.user_id = p.id
                                and sm.status = 'active'),
            'remaining', coalesce((
              select sum(i.amount_due - i.amount_paid) from public.org_installments i
              where i.fund_id = f.id and i.user_id = p.id and i.exempted_at is null
                and i.due_date < current_date), 0),
            'lateCount', (
              select count(*) from public.org_installments i
              where i.fund_id = f.id and i.user_id = p.id and i.exempted_at is null
                and i.due_date < current_date and i.amount_paid < i.amount_due),
            'totalPaid', coalesce((
              select sum(pay.amount) from public.org_payments pay
              where pay.fund_id = f.id and pay.user_id = p.id and pay.cancelled_at is null), 0),
            'lastPaymentAt', (
              select max(pay.created_at) from public.org_payments pay
              where pay.fund_id = f.id and pay.user_id = p.id and pay.cancelled_at is null),
            'installments', coalesce((
              select jsonb_agg(private.org_installment_json(i) order by i.due_date)
              from public.org_installments i
              where i.fund_id = f.id and i.user_id = p.id
                and i.due_date between year_start and year_end
            ), '[]'::jsonb)
          ) as member
        from public.profiles p
        left join public.organization_members om
          on om.organization_id = o.id and om.user_id = p.id
        where p.id in (
          select sm.user_id from public.structure_members sm
          where sm.structure_id = s.id and sm.status = 'active'
          union
          select i.user_id from public.org_installments i where i.fund_id = f.id
          union
          select pay.user_id from public.org_payments pay where pay.fund_id = f.id
        )
      ) x
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pay.id, 'userId', pay.user_id, 'firstName', p.first_name, 'lastName', p.last_name,
        'amount', pay.amount, 'method', pay.method, 'reference', pay.reference,
        'receiptNumber', pay.receipt_number, 'createdAt', pay.created_at,
        'recordedBy', private.full_name(pay.recorded_by),
        'cancelledAt', pay.cancelled_at, 'cancelReason', pay.cancel_reason
      ) order by pay.created_at desc)
      from (select * from public.org_payments where fund_id = f.id
            order by created_at desc limit 100) pay
      join public.profiles p on p.id = pay.user_id
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Paiements
-- ---------------------------------------------------------------------------

create or replace function private.next_receipt_number(p_org uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.organizations;
begin
  update public.organizations set next_receipt_number = next_receipt_number + 1
  where id = p_org returning * into o;
  return o.short_name || '-R' || to_char(current_date, 'YYYY') || '-'
    || lpad((o.next_receipt_number - 1)::text, 6, '0');
end;
$$;

-- Enregistre un paiement (espèces, virement…) et le répartit sur les échéances non
-- soldées, de la plus ancienne à la plus récente. Renvoie l'identifiant du paiement.
create or replace function public.org_payment_record(
  p_fund uuid,
  p_user uuid,
  p_amount integer,
  p_method public.org_payment_method,
  p_reference text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.org_funds := private.require_fund(p_fund);
  s public.org_structures := private.require_structure(f.structure_id);
  o public.organizations := private.require_organization(s.organization_id);
  uid uuid := private.require_money_rights(s.id);
  v_reference text := nullif(btrim(coalesce(p_reference, '')), '');
  open_total integer;
  left_amount integer := coalesce(p_amount, 0);
  payment_id uuid;
  receipt text;
  i public.org_installments;
  part integer;
begin
  perform private.inspect_input('reference', v_reference);
  if left_amount <= 0 or left_amount > 10000000 then
    raise exception 'Montant invalide.' using errcode = '22023';
  end if;
  if char_length(coalesce(v_reference, '')) > 80 then
    raise exception 'Référence trop longue (80 caractères au plus).' using errcode = '22023';
  end if;
  if p_method in ('wave', 'orange_money', 'virement') and v_reference is null then
    raise exception 'Indiquez la référence de la transaction.' using errcode = '22023';
  end if;
  if v_reference is not null and exists (
    select 1 from public.org_payments x
    join public.org_funds xf on xf.id = x.fund_id
    join public.org_structures xs on xs.id = xf.structure_id
    where xs.organization_id = o.id and x.method = p_method and x.reference = v_reference
      and x.cancelled_at is null
  ) then
    raise exception 'Cette référence de transaction a déjà été enregistrée.' using errcode = '23505';
  end if;
  if not exists (
    select 1 from public.structure_members sm
    where sm.structure_id = s.id and sm.user_id = p_user and sm.status = 'active'
  ) and not exists (
    select 1 from public.org_installments x where x.fund_id = f.id and x.user_id = p_user
  ) then
    raise exception 'Cette personne n’est pas membre de la structure.' using errcode = '22023';
  end if;

  if f.kind <> 'volontaire' then
    perform private.org_generate_installments(f.id);
    select coalesce(sum(x.amount_due - x.amount_paid), 0) into open_total
    from public.org_installments x
    where x.fund_id = f.id and x.user_id = p_user and x.exempted_at is null;
    if left_amount > open_total then
      raise exception 'Le montant dépasse ce qui reste à payer (%).', private.format_amount(open_total)
        using errcode = '22023';
    end if;
  end if;

  receipt := private.next_receipt_number(o.id);
  insert into public.org_payments (fund_id, user_id, amount, method, reference,
    receipt_number, recorded_by)
  values (f.id, p_user, left_amount, p_method, v_reference, receipt, uid)
  returning id into payment_id;

  if f.kind <> 'volontaire' then
    for i in
      select * from public.org_installments x
      where x.fund_id = f.id and x.user_id = p_user and x.exempted_at is null
        and x.amount_paid < x.amount_due
      order by x.due_date
      for update
    loop
      exit when left_amount <= 0;
      part := least(left_amount, i.amount_due - i.amount_paid);
      insert into public.org_payment_allocations (payment_id, installment_id, amount)
      values (payment_id, i.id, part);
      update public.org_installments
      set amount_paid = amount_paid + part,
          paid_at = case when amount_paid + part >= amount_due then now() else null end
      where id = i.id;
      left_amount := left_amount - part;
    end loop;
  end if;

  perform private.notify(p_user, 'organization', private.structure_label(s.id),
    format('Paiement de %s reçu pour « %s ». Reçu n° %s.',
      private.format_amount(p_amount), f.name, receipt),
    '/espace/' || o.slug || '/cotisations');
  perform private.audit(uid, 'org_payment_recorded',
    format('a enregistré un paiement de %s dans « %s » (%s, %s)',
      private.format_amount(p_amount), f.name, s.name, o.short_name));
  return payment_id;
end;
$$;

-- Annule un paiement (jamais supprimé) : admin général ou financier uniquement.
create or replace function public.org_payment_cancel(p_payment uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pay public.org_payments;
  f public.org_funds;
  s public.org_structures;
  o public.organizations;
  uid uuid := private.require_uid();
  reason text := nullif(btrim(coalesce(p_reason, '')), '');
  a record;
begin
  select * into pay from public.org_payments where id = p_payment for update;
  if not found then
    raise exception 'Ce paiement est introuvable.' using errcode = 'P0002';
  end if;
  f := private.require_fund(pay.fund_id);
  s := private.require_structure(f.structure_id);
  o := private.require_organization(s.organization_id);
  if not private.has_org_role(o.id, array['org_admin', 'finance_admin']::public.org_role[]) then
    raise exception 'Seule l’administration financière peut annuler un paiement.'
      using errcode = '42501', hint = 'access_denied:structure_money';
  end if;
  if pay.cancelled_at is not null then
    raise exception 'Ce paiement est déjà annulé.' using errcode = '22023';
  end if;
  perform private.inspect_input('reason', reason);
  if reason is null or char_length(reason) > 200 then
    raise exception 'Indiquez le motif de l’annulation (200 caractères au plus).'
      using errcode = '22023';
  end if;

  update public.org_payments
  set cancelled_at = now(), cancelled_by = uid, cancel_reason = reason
  where id = pay.id;
  for a in select * from public.org_payment_allocations where payment_id = pay.id loop
    update public.org_installments
    set amount_paid = amount_paid - a.amount, paid_at = null
    where id = a.installment_id;
  end loop;

  perform private.notify(pay.user_id, 'organization', private.structure_label(s.id),
    format('Le paiement %s de %s a été annulé. Motif : %s',
      pay.receipt_number, private.format_amount(pay.amount), reason),
    '/espace/' || o.slug || '/cotisations');
  perform private.audit(uid, 'org_payment_cancelled',
    format('a annulé le paiement %s de %s (%s)', pay.receipt_number,
      private.format_amount(pay.amount), o.short_name));
end;
$$;

create or replace function public.org_installment_exempt(p_installment uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.org_installments;
  f public.org_funds;
  uid uuid;
  reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into i from public.org_installments where id = p_installment for update;
  if not found then
    raise exception 'Cette échéance est introuvable.' using errcode = 'P0002';
  end if;
  f := private.require_fund(i.fund_id);
  uid := private.require_money_rights(f.structure_id);
  if i.exempted_at is not null then
    raise exception 'Cette échéance est déjà exemptée.' using errcode = '22023';
  end if;
  if i.amount_paid > 0 then
    raise exception 'Cette échéance a déjà reçu un paiement.' using errcode = '22023';
  end if;
  perform private.inspect_input('reason', reason);
  if reason is null or char_length(reason) > 200 then
    raise exception 'Une exemption doit être justifiée (200 caractères au plus).'
      using errcode = '22023';
  end if;
  update public.org_installments
  set exempted_at = now(), exempted_by = uid, exemption_reason = reason
  where id = i.id;
  perform private.notify(i.user_id, 'organization', private.structure_label(f.structure_id),
    format('Vous êtes exempté de l’échéance du %s de « %s ». Motif : %s',
      to_char(i.due_date, 'DD/MM/YYYY'), f.name, reason), null);
  perform private.audit(uid, 'org_installment_exempted',
    format('a exempté une échéance de « %s »', f.name));
end;
$$;

-- Reçu d'un paiement : la personne qui a payé, ou ceux qui voient la caisse.
create or replace function public.org_receipt(p_payment uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  pay public.org_payments;
  f public.org_funds;
  s public.org_structures;
  o public.organizations;
  p public.profiles;
  om public.organization_members;
begin
  select * into pay from public.org_payments where id = p_payment;
  if not found then
    raise exception 'Ce reçu est introuvable.' using errcode = 'P0002';
  end if;
  f := private.require_fund(pay.fund_id);
  s := private.require_structure(f.structure_id);
  if pay.user_id <> uid and not private.views_structure_money(s.id) then
    raise exception 'Ce reçu ne vous concerne pas.' using errcode = '42501';
  end if;
  o := private.require_organization(s.organization_id);
  select * into p from public.profiles where id = pay.user_id;
  select * into om from public.organization_members
  where organization_id = o.id and user_id = pay.user_id;
  return jsonb_build_object(
    'organization', private.org_json(o),
    'receiptNumber', pay.receipt_number,
    'memberName', p.first_name || ' ' || p.last_name,
    'memberNumber', om.member_number,
    'amount', pay.amount,
    'fundName', f.name, 'fundKind', f.kind,
    'structureName', s.name,
    'createdAt', pay.created_at,
    'method', pay.method, 'reference', pay.reference,
    'cancelledAt', pay.cancelled_at, 'cancelReason', pay.cancel_reason,
    'recordedBy', private.full_name(pay.recorded_by),
    'periods', coalesce((
      select jsonb_agg(jsonb_build_object('dueDate', i.due_date, 'amount', a.amount)
                       order by i.due_date)
      from public.org_payment_allocations a
      join public.org_installments i on i.id = a.installment_id
      where a.payment_id = pay.id
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Côté militant : mes cotisations dans une organisation
-- ---------------------------------------------------------------------------

create or replace function public.my_org_dues(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  o public.organizations := private.require_org_by_slug(p_slug);
  v_fund uuid;
begin
  -- Échéances du jour à jour pour les caisses de mes structures.
  for v_fund in
    select f.id from public.org_funds f
    join public.structure_members sm on sm.structure_id = f.structure_id
    join public.org_structures s on s.id = f.structure_id
    where sm.user_id = uid and sm.status = 'active' and s.organization_id = o.id
      and not f.is_closed
  loop
    perform private.org_generate_installments(v_fund);
  end loop;

  return jsonb_build_object(
    'funds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'name', f.name, 'kind', f.kind, 'amount', f.amount,
        'frequency', f.frequency, 'dueDay', f.due_day, 'isClosed', f.is_closed,
        'structureId', s.id, 'structureName', s.name,
        'installments', coalesce((
          select jsonb_agg(private.org_installment_json(i) order by i.due_date desc)
          from public.org_installments i where i.fund_id = f.id and i.user_id = uid
        ), '[]'::jsonb)
      ) order by s.name, f.created_at)
      from public.org_funds f
      join public.org_structures s on s.id = f.structure_id
      where s.organization_id = o.id and (
        exists (select 1 from public.org_installments i where i.fund_id = f.id and i.user_id = uid)
        or exists (select 1 from public.org_payments pay where pay.fund_id = f.id and pay.user_id = uid)
        or (f.kind = 'volontaire' and not f.is_closed and exists (
              select 1 from public.structure_members sm
              where sm.structure_id = s.id and sm.user_id = uid and sm.status = 'active'))
      )
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pay.id, 'fundId', pay.fund_id, 'fundName', f.name, 'fundKind', f.kind,
        'structureName', s.name, 'amount', pay.amount, 'method', pay.method,
        'reference', pay.reference, 'receiptNumber', pay.receipt_number,
        'createdAt', pay.created_at, 'cancelledAt', pay.cancelled_at
      ) order by pay.created_at desc)
      from public.org_payments pay
      join public.org_funds f on f.id = pay.fund_id
      join public.org_structures s on s.id = f.structure_id
      where pay.user_id = uid and s.organization_id = o.id
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Rappels automatiques (notifications push) : J-2, jour J, J+3, J+7
-- ---------------------------------------------------------------------------

create or replace function private.org_send_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  sent integer := 0;
begin
  perform private.org_generate_all();
  for r in
    select i.id, i.user_id, i.due_date, i.amount_due - i.amount_paid as left_amount,
      f.name as fund_name, f.structure_id, o.slug,
      (current_date - i.due_date) as offset_days
    from public.org_installments i
    join public.org_funds f on f.id = i.fund_id
    join public.org_structures s on s.id = f.structure_id
    join public.organizations o on o.id = s.organization_id
    where i.exempted_at is null and i.amount_paid < i.amount_due
      and (current_date - i.due_date) in (-2, 0, 3, 7)
      and not o.is_suspended and s.status = 'active'
      and exists (select 1 from public.structure_members sm
                  where sm.structure_id = s.id and sm.user_id = i.user_id and sm.status = 'active')
      and not exists (select 1 from public.org_reminders x
                      where x.installment_id = i.id and x.offset_days = (current_date - i.due_date))
  loop
    insert into public.org_reminders (installment_id, offset_days) values (r.id, r.offset_days);
    perform private.notify(r.user_id, 'reminder', private.structure_label(r.structure_id),
      case
        when r.offset_days < 0 then format('Votre cotisation « %s » de %s est due le %s.',
          r.fund_name, private.format_amount(r.left_amount), to_char(r.due_date, 'DD/MM/YYYY'))
        when r.offset_days = 0 then format('Votre cotisation « %s » de %s est due aujourd’hui.',
          r.fund_name, private.format_amount(r.left_amount))
        else format('Votre cotisation « %s » du %s est en retard : il reste %s à payer.',
          r.fund_name, to_char(r.due_date, 'DD/MM/YYYY'), private.format_amount(r.left_amount))
      end,
      '/espace/' || r.slug || '/cotisations');
    sent := sent + 1;
  end loop;
  return sent;
end;
$$;

create extension if not exists pg_cron;
select cron.schedule('afp-cotisations', '0 9 * * *', 'select private.org_send_reminders()');
-- Codes SMS périmés : purgés chaque nuit.
select cron.schedule('afp-purge-codes', '30 3 * * *', 'select public.svc_purge_auth_otps()');

-- ---------------------------------------------------------------------------
-- Nouvelles adhésions : leurs échéances sont créées tout de suite
-- ---------------------------------------------------------------------------

create or replace function private.structure_members_generate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    perform private.org_generate_structure(new.structure_id);
  elsif tg_op = 'UPDATE' and old.status = 'active' and new.status <> 'active' then
    perform private.org_generate_structure(new.structure_id);
  end if;
  return new;
end;
$$;

create trigger structure_members_generate
  after insert or update of status on public.structure_members
  for each row execute function private.structure_members_generate();

-- ---------------------------------------------------------------------------
-- Totaux dans les vues existantes
-- ---------------------------------------------------------------------------

-- Super admin : encaissé total par organisation (chiffre global seulement).
create or replace function public.organizations_collected()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_super_admin();
  return coalesce((
    select jsonb_object_agg(o.id, coalesce((
      select sum(p.amount) from public.org_payments p
      join public.org_funds f on f.id = p.fund_id
      join public.org_structures s on s.id = f.structure_id
      where s.organization_id = o.id and p.cancelled_at is null), 0))
    from public.organizations o
  ), '{}'::jsonb);
end;
$$;

-- Administration : encaissé et reste à recouvrer, par structure visible.
create or replace function public.organization_money_summary(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.organizations := private.require_org_by_slug(p_slug);
  uid uuid := private.require_uid();
begin
  return coalesce((
    select jsonb_object_agg(s.id, jsonb_build_object(
      'collected', coalesce((
        select sum(p.amount) from public.org_payments p
        join public.org_funds f on f.id = p.fund_id
        where f.structure_id = s.id and p.cancelled_at is null), 0),
      'remaining', coalesce((
        select sum(i.amount_due - i.amount_paid) from public.org_installments i
        join public.org_funds f on f.id = i.fund_id
        where f.structure_id = s.id and i.exempted_at is null and i.due_date < current_date), 0)
    ))
    from public.org_structures s
    where s.organization_id = o.id and private.views_structure_money(s.id)
  ), '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Accès aux fonctions
-- ---------------------------------------------------------------------------

revoke all on function
  public.org_fund_save(uuid, uuid, text, public.org_fund_kind, integer,
    public.org_fund_frequency, date, integer, date),
  public.org_fund_close(uuid, boolean),
  public.structure_funds(uuid),
  public.org_fund_view(uuid, integer),
  public.org_payment_record(uuid, uuid, integer, public.org_payment_method, text),
  public.org_payment_cancel(uuid, text),
  public.org_installment_exempt(uuid, text),
  public.org_receipt(uuid),
  public.my_org_dues(text),
  public.organizations_collected(),
  public.organization_money_summary(text)
from public, anon;

grant execute on function
  public.org_fund_save(uuid, uuid, text, public.org_fund_kind, integer,
    public.org_fund_frequency, date, integer, date),
  public.org_fund_close(uuid, boolean),
  public.structure_funds(uuid),
  public.org_fund_view(uuid, integer),
  public.org_payment_record(uuid, uuid, integer, public.org_payment_method, text),
  public.org_payment_cancel(uuid, text),
  public.org_installment_exempt(uuid, text),
  public.org_receipt(uuid),
  public.my_org_dues(text),
  public.organizations_collected(),
  public.organization_money_summary(text)
to authenticated;
