-- Dépenses : demande, vérification, validation centrale, engagement, paiement,
-- justification (cahier § 3.4, § 12 et § 17).
--
-- Séparation des fonctions : celui qui demande ne vérifie ni ne décide ; celui qui
-- vérifie ne décide pas ; celui qui décide ne paie pas. Au-delà du plafond des
-- paramètres, seule l'administration générale approuve. Une décision porte toujours une
-- date et une justification ; l'historique de chaque étape est conservé.
-- Approuvée ≠ payée : le paiement crée l'opération comptable (sortie de la caisse).

create type public.org_expense_status as enum (
  'submitted',      -- demandée
  'info_requested', -- informations complémentaires demandées
  'verified',       -- disponibilité vérifiée par le service financier
  'approved',       -- approuvée (totalement ou partiellement)
  'rejected',
  'committed',      -- engagée
  'paid',           -- payée, justificatifs attendus
  'closed',         -- justifiée et clôturée
  'cancelled'       -- retirée par le demandeur
);

-- Numéros lisibles par organisation, type et année (« AFP-D2026-0001 »).
create table private.org_counters (
  organization_id uuid not null,
  kind text not null,
  year integer not null,
  value integer not null default 0,
  primary key (organization_id, kind, year)
);

create or replace function private.next_number(p_org uuid, p_kind text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year integer := extract(year from current_date)::int;
  v_value integer;
begin
  insert into private.org_counters (organization_id, kind, year, value)
  values (p_org, p_kind, v_year, 1)
  on conflict (organization_id, kind, year)
  do update set value = private.org_counters.value + 1
  returning value into v_value;
  return (select o.short_name from public.organizations o where o.id = p_org)
    || '-' || p_kind || v_year || '-' || lpad(v_value::text, 4, '0');
end;
$$;

create table public.org_expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  number text not null unique,
  -- Caisse concernée : celle de la structure, ou le fonds commun.
  account public.org_account not null check (account in ('structure', 'common')),
  -- Structure bénéficiaire (obligatoire pour une caisse de structure).
  structure_id uuid references public.org_structures (id) on delete restrict,
  object text not null check (char_length(btrim(object)) between 3 and 120),
  category text not null check (category in ('activite', 'fonctionnement', 'communication',
    'transport', 'materiel', 'social', 'formation', 'autre')),
  motive text not null check (char_length(btrim(motive)) between 3 and 1000),
  amount_requested integer not null check (amount_requested between 100 and 100000000),
  amount_approved integer check (amount_approved between 100 and 100000000),
  amount_paid integer not null default 0 check (amount_paid >= 0),
  amount_justified integer check (amount_justified >= 0),
  status public.org_expense_status not null default 'submitted',
  requested_by uuid references public.profiles (id) on delete set null,
  verified_by uuid references public.profiles (id) on delete set null,
  verified_at timestamptz,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  decision_note text check (char_length(decision_note) <= 500),
  committed_by uuid references public.profiles (id) on delete set null,
  committed_at timestamptz,
  paid_by uuid references public.profiles (id) on delete set null,
  paid_at timestamptz,
  method public.org_payment_method,
  reference text check (char_length(reference) <= 80),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint org_expenses_structure check (account <> 'structure' or structure_id is not null),
  constraint org_expenses_paid check (amount_paid <= coalesce(amount_approved, 0))
);

create index org_expenses_org_idx on public.org_expenses (organization_id, status, created_at desc);
create index org_expenses_structure_idx on public.org_expenses (structure_id);

create trigger org_expenses_updated_at
  before update on public.org_expenses
  for each row execute function private.set_updated_at();

-- Historique des étapes (Expense_approvals).
create table public.org_expense_events (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.org_expenses (id) on delete cascade,
  status public.org_expense_status not null,
  actor_id uuid references public.profiles (id) on delete set null,
  amount integer,
  note text check (char_length(note) <= 1000),
  at timestamptz not null default now()
);

create index org_expense_events_idx on public.org_expense_events (expense_id, at);

create trigger org_expense_events_append_only
  before update or delete on public.org_expense_events
  for each row when (pg_trigger_depth() = 0)
  execute function private.forbid_change();

alter table public.org_entries
  add column expense_id uuid references public.org_expenses (id) on delete restrict;
create index org_entries_expense_idx on public.org_entries (expense_id);

alter table public.org_expenses enable row level security;
alter table public.org_expense_events enable row level security;
revoke all on public.org_expenses, public.org_expense_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Engagements et disponible
-- ---------------------------------------------------------------------------

-- Montants approuvés mais pas encore payés (complété par les financements).
create or replace function private.account_engaged(
  p_org uuid, p_account public.org_account, p_structure uuid default null
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(x.amount_approved - x.amount_paid), 0)
  from public.org_expenses x
  where x.organization_id = p_org and x.account = p_account
    and (p_account <> 'structure' or x.structure_id = p_structure)
    and x.status in ('approved', 'committed')
$$;

create or replace function private.account_available(
  p_org uuid, p_account public.org_account, p_structure uuid default null
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select private.account_balance(p_org, p_account,
           case when p_account = 'structure' then p_structure end)
       - private.account_engaged(p_org, p_account, p_structure)
$$;

-- ---------------------------------------------------------------------------
-- Droits
-- ---------------------------------------------------------------------------

create or replace function private.require_expense(p_id uuid)
returns public.org_expenses
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  x public.org_expenses;
begin
  select * into x from public.org_expenses where id = p_id;
  if not found then
    raise exception 'Cette demande de dépense est introuvable.' using errcode = 'P0002';
  end if;
  return x;
end;
$$;

create or replace function private.expense_visible(x public.org_expenses)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.sees_org_finance(x.organization_id)
    or x.requested_by = private.active_uid()
    or (x.structure_id is not null and private.views_structure_money(x.structure_id))
$$;

-- Paie une dépense : administration financière, ou trésorier / responsable pour une
-- caisse de structure.
create or replace function private.expense_payer(x public.org_expenses)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_org_role(x.organization_id, array['finance_admin']::public.org_role[])
    or (x.account = 'structure' and exists (
      select 1 from public.structure_roles r
      where r.user_id = private.active_uid() and r.role in ('responsable', 'tresorier')
        and r.structure_id in (select a.id from private.structure_ancestors(x.structure_id) a)))
$$;

create or replace function private.expense_event(
  p_expense uuid, p_status public.org_expense_status, p_actor uuid, p_amount integer, p_note text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.org_expense_events (expense_id, status, actor_id, amount, note)
  values (p_expense, p_status, p_actor, p_amount, p_note);
$$;

create or replace function private.clean_text(p_field text, p_value text, p_max integer)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text := nullif(btrim(coalesce(p_value, '')), '');
begin
  perform private.inspect_input(p_field, v);
  if char_length(coalesce(v, '')) > p_max then
    raise exception 'Texte trop long (% caractères au plus).', p_max using errcode = '22023';
  end if;
  return v;
end;
$$;

create or replace function private.require_note(p_value text, p_message text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text := private.clean_text('note', p_value, 500);
begin
  if v is null or char_length(v) < 3 then
    raise exception '%', p_message using errcode = '22023';
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Étapes
-- ---------------------------------------------------------------------------

create or replace function public.org_expense_submit(
  p_slug text,
  p_account public.org_account,
  p_structure uuid,
  p_object text,
  p_category text,
  p_motive text,
  p_amount integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  o public.organizations := private.require_org_by_slug(p_slug);
  v_object text := private.clean_text('object', p_object, 120);
  v_motive text := private.clean_text('motive', p_motive, 1000);
  v_id uuid;
  v_number text;
  v_structure text;
begin
  if p_account not in ('structure', 'common') then
    raise exception 'Choisissez la caisse concernée.' using errcode = '22023';
  end if;
  if p_structure is not null and not exists (
    select 1 from public.org_structures s
    where s.id = p_structure and s.organization_id = o.id and s.status = 'active'
  ) then
    raise exception 'Structure introuvable ou inactive.' using errcode = 'P0002';
  end if;
  if p_account = 'structure' then
    if p_structure is null then
      raise exception 'Choisissez la structure.' using errcode = '22023';
    end if;
    if not (private.manages_structure(p_structure) or private.has_org_role(o.id,
            array['org_admin', 'finance_admin']::public.org_role[])) then
      raise exception 'Seuls les responsables de la structure demandent une dépense sur sa caisse.'
        using errcode = '42501', hint = 'access_denied:expense';
    end if;
  elsif not private.has_org_role(o.id,
          array['org_admin', 'finance_admin', 'projects_manager']::public.org_role[]) then
    raise exception 'Seule l’administration centrale demande une dépense sur le fonds commun.'
      using errcode = '42501', hint = 'access_denied:expense';
  end if;
  if v_object is null or char_length(v_object) < 3 then
    raise exception 'Indiquez l’objet de la dépense.' using errcode = '22023';
  end if;
  if v_motive is null or char_length(v_motive) < 3 then
    raise exception 'Indiquez le motif de la dépense.' using errcode = '22023';
  end if;
  if coalesce(p_amount, 0) < 100 or p_amount > 100000000 then
    raise exception 'Montant invalide.' using errcode = '22023';
  end if;

  v_number := private.next_number(o.id, 'D');
  insert into public.org_expenses (organization_id, number, account, structure_id, object,
    category, motive, amount_requested, requested_by)
  values (o.id, v_number, p_account, p_structure, v_object, coalesce(p_category, 'autre'),
    v_motive, p_amount, uid)
  returning id into v_id;
  perform private.expense_event(v_id, 'submitted', uid, p_amount, v_motive);

  v_structure := coalesce((select s.name from public.org_structures s where s.id = p_structure),
    'Fonds commun');
  -- Prévenir ceux qui vérifient.
  perform private.notify(r.user_id, 'organization', o.short_name || ' – Dépenses',
    format('Nouvelle demande de dépense %s : « %s » (%s, %s).', v_number, v_object,
      private.format_amount(p_amount), v_structure),
    '/espace/' || o.slug || '/admin/depenses/' || v_id)
  from (select distinct r.user_id from public.organization_roles r
        where r.organization_id = o.id and r.role in ('finance_admin', 'controller')
          and r.user_id <> uid) r;
  perform private.audit(uid, 'org_expense_submitted',
    format('a demandé la dépense %s « %s » (%s, %s)', v_number, v_object,
      private.format_amount(p_amount), v_structure));
  return v_id;
end;
$$;

-- Vérification de la disponibilité par le service financier.
create or replace function public.org_expense_verify(p_id uuid, p_ok boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  x public.org_expenses := private.require_expense(p_id);
  uid uuid := private.require_org_roles(x.organization_id,
    array['finance_admin', 'controller']::public.org_role[],
    'La vérification est faite par l’administration financière ou le contrôleur.');
  v_note text := private.clean_text('note', p_note, 500);
  v_available bigint := private.account_available(x.organization_id, x.account, x.structure_id);
begin
  if x.status <> 'submitted' then
    raise exception 'Cette demande n’est pas en attente de vérification.' using errcode = '22023';
  end if;
  if x.requested_by = uid then
    raise exception 'Vous ne pouvez pas vérifier votre propre demande.'
      using errcode = '42501', hint = 'access_denied:separation';
  end if;
  if p_ok then
    if v_available < x.amount_requested then
      raise exception 'Ressources insuffisantes : disponible %.',
        private.format_amount(v_available::integer) using errcode = '22023';
    end if;
    update public.org_expenses set status = 'verified', verified_by = uid, verified_at = now()
    where id = x.id;
    perform private.expense_event(x.id, 'verified', uid, null,
      coalesce(v_note, format('Disponible : %s', private.format_amount(v_available::integer))));
    perform private.notify(r.user_id, 'organization',
      (select o.short_name from public.organizations o where o.id = x.organization_id) || ' – Dépenses',
      format('Dépense %s vérifiée, en attente de votre décision.', x.number),
      '/espace/' || (select o.slug from public.organizations o where o.id = x.organization_id)
        || '/admin/depenses/' || x.id)
    from (select distinct r.user_id from public.organization_roles r
          where r.organization_id = x.organization_id and r.role in ('validator', 'org_admin')
            and r.user_id <> uid) r;
  else
    v_note := private.require_note(p_note, 'Indiquez ce qui manque ou pose problème.');
    update public.org_expenses set status = 'info_requested' where id = x.id;
    perform private.expense_event(x.id, 'info_requested', uid, null, v_note);
    perform private.notify(x.requested_by, 'organization',
      private.structure_label(x.structure_id),
      format('Dépense %s : informations demandées. %s', x.number, v_note), null);
  end if;
  perform private.audit(uid, 'org_expense_decided',
    format('a %s la dépense %s', case when p_ok then 'vérifié' else 'demandé des précisions sur' end,
      x.number));
end;
$$;

-- Le demandeur répond à une demande d'informations : la demande repart en vérification.
create or replace function public.org_expense_reply(p_id uuid, p_note text, p_amount integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  x public.org_expenses := private.require_expense(p_id);
  uid uuid := private.require_uid();
  v_note text := private.require_note(p_note, 'Écrivez votre réponse.');
begin
  if x.requested_by is distinct from uid then
    raise exception 'Seul le demandeur répond.' using errcode = '42501',
      hint = 'access_denied:expense';
  end if;
  if x.status <> 'info_requested' then
    raise exception 'Aucune information n’est demandée.' using errcode = '22023';
  end if;
  if p_amount is not null and (p_amount < 100 or p_amount > 100000000) then
    raise exception 'Montant invalide.' using errcode = '22023';
  end if;
  update public.org_expenses
  set status = 'submitted', amount_requested = coalesce(p_amount, amount_requested)
  where id = x.id;
  perform private.expense_event(x.id, 'submitted', uid, p_amount, v_note);
end;
$$;

-- Décision de l'autorité centrale : approuver (montant partiel possible), rejeter ou
-- demander des informations. Toujours datée et justifiée.
create or replace function public.org_expense_decide(
  p_id uuid, p_decision text, p_amount integer, p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  x public.org_expenses := private.require_expense(p_id);
  uid uuid := private.require_org_roles(x.organization_id,
    array['validator', 'org_admin']::public.org_role[],
    'La décision revient à l’autorité centrale de validation.');
  settings jsonb := private.org_settings(x.organization_id);
  v_note text := private.require_note(p_note, 'Justifiez la décision.');
  v_amount integer := coalesce(p_amount, x.amount_requested);
  v_status public.org_expense_status;
begin
  if not (x.status = 'verified'
          or (x.status = 'submitted' and not (settings ->> 'expenseNeedsVerification')::boolean)) then
    raise exception 'Cette demande doit d’abord être vérifiée par le service financier.'
      using errcode = '22023';
  end if;
  if x.requested_by = uid or x.verified_by = uid then
    raise exception 'Vous avez déjà demandé ou vérifié cette dépense : une autre personne décide.'
      using errcode = '42501', hint = 'access_denied:separation';
  end if;

  if p_decision = 'approve' then
    if v_amount < 100 or v_amount > x.amount_requested then
      raise exception 'Le montant approuvé doit être compris entre 100 FCFA et le montant demandé.'
        using errcode = '22023';
    end if;
    if v_amount > (settings ->> 'expenseCeiling')::integer
       and not private.is_org_admin(x.organization_id) then
      raise exception 'Au-delà du plafond de %, seule l’administration générale approuve.',
        private.format_amount((settings ->> 'expenseCeiling')::integer)
        using errcode = '42501', hint = 'access_denied:ceiling';
    end if;
    if private.account_available(x.organization_id, x.account, x.structure_id) < v_amount then
      raise exception 'Ressources insuffisantes dans la caisse concernée.' using errcode = '22023';
    end if;
    v_status := 'approved';
    update public.org_expenses
    set status = 'approved', amount_approved = v_amount, decided_by = uid, decided_at = now(),
        decision_note = v_note
    where id = x.id;
  elsif p_decision = 'reject' then
    v_status := 'rejected';
    update public.org_expenses
    set status = 'rejected', decided_by = uid, decided_at = now(), decision_note = v_note
    where id = x.id;
  elsif p_decision = 'info' then
    v_status := 'info_requested';
    update public.org_expenses set status = 'info_requested' where id = x.id;
  else
    raise exception 'Décision invalide.' using errcode = '22023';
  end if;

  perform private.expense_event(x.id, v_status, uid,
    case when v_status = 'approved' then v_amount end, v_note);
  perform private.notify(x.requested_by, 'organization',
    coalesce(private.structure_label(x.structure_id),
      (select o.short_name from public.organizations o where o.id = x.organization_id)),
    format('Dépense %s %s. %s', x.number, case v_status
      when 'approved' then case when v_amount < x.amount_requested
        then 'approuvée partiellement (' || private.format_amount(v_amount) || ')'
        else 'approuvée' end
      when 'rejected' then 'rejetée'
      else ': informations demandées' end, v_note), null);
  perform private.audit(uid, 'org_expense_decided',
    format('a %s la dépense %s', case v_status when 'approved' then 'approuvé'
      when 'rejected' then 'rejeté' else 'demandé des précisions sur' end, x.number));
end;
$$;

create or replace function public.org_expense_commit(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  x public.org_expenses := private.require_expense(p_id);
  uid uuid := private.require_uid();
  v_note text := private.clean_text('note', p_note, 500);
begin
  if not private.expense_payer(x) then
    raise exception 'Réservé au trésorier ou à l’administration financière.'
      using errcode = '42501', hint = 'access_denied:expense';
  end if;
  if x.status <> 'approved' then
    raise exception 'Seule une dépense approuvée peut être engagée.' using errcode = '22023';
  end if;
  update public.org_expenses set status = 'committed', committed_by = uid, committed_at = now()
  where id = x.id;
  perform private.expense_event(x.id, 'committed', uid, null, v_note);
end;
$$;

-- Paiement effectif : sortie de la caisse (opération comptable).
create or replace function public.org_expense_pay(
  p_id uuid, p_amount integer, p_method public.org_payment_method, p_reference text, p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  x public.org_expenses := private.require_expense(p_id);
  uid uuid := private.require_uid();
  v_reference text := private.clean_text('reference', p_reference, 80);
  v_note text := private.clean_text('note', p_note, 500);
  v_entry uuid;
begin
  if not private.expense_payer(x) then
    raise exception 'Réservé au trésorier ou à l’administration financière.'
      using errcode = '42501', hint = 'access_denied:expense';
  end if;
  if x.status not in ('approved', 'committed') then
    raise exception 'Seule une dépense approuvée peut être payée.' using errcode = '22023';
  end if;
  if x.decided_by = uid then
    raise exception 'Vous avez approuvé cette dépense : une autre personne la paie.'
      using errcode = '42501', hint = 'access_denied:separation';
  end if;
  if coalesce(p_amount, 0) <= 0 or p_amount > x.amount_approved then
    raise exception 'Le montant payé ne peut dépasser le montant approuvé (%).',
      private.format_amount(x.amount_approved) using errcode = '22023';
  end if;
  if p_method is null then
    raise exception 'Indiquez le mode de paiement.' using errcode = '22023';
  end if;
  perform private.check_reference(x.organization_id, p_method, v_reference);
  if private.account_balance(x.organization_id, x.account,
       case when x.account = 'structure' then x.structure_id end) < p_amount then
    raise exception 'Solde insuffisant dans la caisse concernée.' using errcode = '22023';
  end if;

  v_entry := private.entry_create(x.organization_id, 'depense', p_amount,
    format('Dépense %s – %s', x.number, x.object),
    jsonb_build_object('structure_id', x.structure_id, 'expense_id', x.id, 'method', p_method,
      'reference', v_reference, 'note', v_note, 'validated_by', x.decided_by));
  perform private.entry_move(v_entry, x.account,
    case when x.account = 'structure' then x.structure_id end, 'treasury', null, p_amount);

  update public.org_expenses
  set status = 'paid', amount_paid = p_amount, paid_by = uid, paid_at = now(),
      method = p_method, reference = v_reference
  where id = x.id;
  perform private.expense_event(x.id, 'paid', uid, p_amount, v_note);
  perform private.notify(x.requested_by, 'organization',
    coalesce(private.structure_label(x.structure_id),
      (select o.short_name from public.organizations o where o.id = x.organization_id)),
    format('Dépense %s payée (%s). Déposez les justificatifs pour la clôturer.', x.number,
      private.format_amount(p_amount)), null);
  perform private.audit(uid, 'org_expense_paid',
    format('a payé la dépense %s (%s)', x.number, private.format_amount(p_amount)));
  return v_entry;
end;
$$;

-- Justification : au moins une pièce jointe, montant justifié ; la dépense est clôturée.
create or replace function public.org_expense_justify(p_id uuid, p_amount integer, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  x public.org_expenses := private.require_expense(p_id);
  uid uuid := private.require_uid();
  v_note text := private.clean_text('note', p_note, 500);
begin
  if not (x.requested_by = uid or private.expense_payer(x)) then
    raise exception 'Réservé au demandeur ou au trésorier.' using errcode = '42501',
      hint = 'access_denied:expense';
  end if;
  if x.status <> 'paid' then
    raise exception 'Seule une dépense payée peut être justifiée.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.org_documents d
                 where d.entity_type = 'expense' and d.entity_id = x.id) then
    raise exception 'Joignez d’abord au moins un justificatif (facture, reçu…).'
      using errcode = '22023';
  end if;
  if coalesce(p_amount, -1) < 0 or p_amount > 100000000 then
    raise exception 'Indiquez le montant justifié.' using errcode = '22023';
  end if;
  update public.org_expenses
  set status = 'closed', amount_justified = p_amount, closed_at = now()
  where id = x.id;
  perform private.expense_event(x.id, 'closed', uid, p_amount,
    coalesce(v_note, case when p_amount < x.amount_paid
      then 'Écart : ' || private.format_amount(x.amount_paid - p_amount) || ' non justifié' end));
end;
$$;

create or replace function public.org_expense_cancel(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  x public.org_expenses := private.require_expense(p_id);
  uid uuid := private.require_uid();
  v_note text := private.clean_text('note', p_note, 500);
begin
  if x.requested_by is distinct from uid then
    raise exception 'Seul le demandeur retire sa demande.' using errcode = '42501',
      hint = 'access_denied:expense';
  end if;
  if x.status not in ('submitted', 'info_requested', 'verified') then
    raise exception 'Cette demande ne peut plus être retirée.' using errcode = '22023';
  end if;
  update public.org_expenses set status = 'cancelled' where id = x.id;
  perform private.expense_event(x.id, 'cancelled', uid, null, v_note);
end;
$$;

-- ---------------------------------------------------------------------------
-- Lectures
-- ---------------------------------------------------------------------------

create or replace function private.expense_json(x public.org_expenses)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', x.id, 'number', x.number, 'account', x.account, 'structureId', x.structure_id,
    'structureName', (select s.name from public.org_structures s where s.id = x.structure_id),
    'object', x.object, 'category', x.category, 'motive', x.motive,
    'amountRequested', x.amount_requested, 'amountApproved', x.amount_approved,
    'amountPaid', x.amount_paid, 'amountJustified', x.amount_justified, 'status', x.status,
    'requestedBy', private.full_name(x.requested_by), 'createdAt', x.created_at,
    'decidedAt', x.decided_at, 'decisionNote', x.decision_note, 'paidAt', x.paid_at,
    'method', x.method, 'reference', x.reference, 'closedAt', x.closed_at
  )
$$;

create or replace function public.org_expenses_page(
  p_slug text, p_status public.org_expense_status, p_structure uuid, p_query text, p_offset integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  o public.organizations := private.require_org_by_slug(p_slug);
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  return (
    with filtered as (
      select x.* from public.org_expenses x
      where x.organization_id = o.id and private.expense_visible(x)
        and (p_status is null or x.status = p_status)
        and (p_structure is null or x.structure_id = p_structure)
        and (v_query is null or x.number ilike '%' || v_query || '%'
             or x.object ilike '%' || v_query || '%')
    )
    select jsonb_build_object(
      'rows', coalesce((
        select jsonb_agg(private.expense_json(f) order by f.created_at desc)
        from (select * from filtered order by created_at desc offset v_offset limit 50) f
      ), '[]'::jsonb),
      'total', (select count(*) from filtered),
      'pageSize', 50,
      'summary', jsonb_build_object(
        'requested', (select coalesce(sum(amount_requested), 0) from filtered
                      where status in ('submitted', 'info_requested', 'verified')),
        'approved', (select coalesce(sum(amount_approved), 0) from filtered
                     where status in ('approved', 'committed', 'paid', 'closed')),
        'paid', (select coalesce(sum(amount_paid), 0) from filtered),
        'justified', (select coalesce(sum(amount_justified), 0) from filtered),
        'toProcess', (select count(*) from filtered
                      where status in ('submitted', 'verified', 'approved', 'committed', 'paid'))
      ),
      'canSubmit', private.has_org_role(o.id,
          array['org_admin', 'finance_admin', 'projects_manager']::public.org_role[])
        or exists (select 1 from public.structure_roles r join public.org_structures s
                   on s.id = r.structure_id where r.user_id = uid and s.organization_id = o.id)
    )
  );
end;
$$;

create or replace function public.org_expense_view(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  x public.org_expenses := private.require_expense(p_id);
  uid uuid := private.require_uid();
  settings jsonb := private.org_settings(x.organization_id);
  needs_check boolean := (settings ->> 'expenseNeedsVerification')::boolean;
begin
  if not private.expense_visible(x) then
    raise exception 'Accès refusé.' using errcode = '42501', hint = 'access_denied:expense';
  end if;
  return private.expense_json(x) || jsonb_build_object(
    'balance', private.account_balance(x.organization_id, x.account,
      case when x.account = 'structure' then x.structure_id end),
    'available', private.account_available(x.organization_id, x.account, x.structure_id),
    'ceiling', (settings ->> 'expenseCeiling')::integer,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('status', e.status, 'actor', private.full_name(e.actor_id),
        'amount', e.amount, 'note', e.note, 'at', e.at) order by e.at)
      from public.org_expense_events e where e.expense_id = x.id
    ), '[]'::jsonb),
    'documents', private.documents_json('expense', x.id),
    'can', jsonb_build_object(
      'verify', x.status = 'submitted' and needs_check and x.requested_by is distinct from uid
        and private.has_org_role(x.organization_id, array['finance_admin', 'controller']::public.org_role[]),
      'decide', (x.status = 'verified' or (x.status = 'submitted' and not needs_check))
        and x.requested_by is distinct from uid and x.verified_by is distinct from uid
        and private.has_org_role(x.organization_id, array['validator', 'org_admin']::public.org_role[]),
      'reply', x.status = 'info_requested' and x.requested_by = uid,
      'commit', x.status = 'approved' and private.expense_payer(x),
      'pay', x.status in ('approved', 'committed') and private.expense_payer(x)
        and x.decided_by is distinct from uid,
      'justify', x.status = 'paid' and (x.requested_by = uid or private.expense_payer(x)),
      'cancel', x.status in ('submitted', 'info_requested', 'verified') and x.requested_by = uid,
      'attach', x.status not in ('rejected', 'cancelled')
        and (x.requested_by = uid or private.expense_payer(x))
    )
  );
end;
$$;

-- Soldes analytiques : chaque caisse visible, le fonds commun et la trésorerie totale.
create or replace function public.organization_balances(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  o public.organizations := private.require_org_by_slug(p_slug);
  central boolean := private.sees_org_finance(o.id);
begin
  return jsonb_build_object(
    'central', central,
    'treasury', case when central then -private.account_balance(o.id, 'treasury') end,
    'common', case when central then jsonb_build_object(
      'balance', private.account_balance(o.id, 'common'),
      'engaged', private.account_engaged(o.id, 'common'),
      'available', private.account_available(o.id, 'common')) end,
    'structures', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'status', s.status,
        'balance', private.account_balance(o.id, 'structure', s.id),
        'engaged', private.account_engaged(o.id, 'structure', s.id),
        'available', private.account_available(o.id, 'structure', s.id),
        'receipts', coalesce((select sum(e.amount) from public.org_entries e
          where e.structure_id = s.id and e.nature = 'recette' and e.cancelled_at is null), 0),
        'toCommon', coalesce((select sum(e.amount) from public.org_entries e
          where e.structure_id = s.id and e.cancelled_at is null
            and e.nature in ('part_fonds_commun', 'contribution_fixe')
             or (e.structure_id = s.id and e.cancelled_at is null
                 and e.nature = 'contribution_volontaire' and e.source_kind = 'structure')), 0),
        'spent', coalesce((select sum(e.amount) from public.org_entries e
          where e.structure_id = s.id and e.nature = 'depense' and e.cancelled_at is null
            and exists (select 1 from public.org_entry_lines l where l.entry_id = e.id
                        and l.account = 'structure')), 0)
      ) order by s.name)
      from public.org_structures s
      where s.organization_id = o.id and private.views_structure_money(s.id)
    ), '[]'::jsonb)
  );
end;
$$;

-- Pièces jointes des dépenses.
create or replace function private.entity_org(p_type text, p_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_type = 'entry' then
    return (select e.organization_id from public.org_entries e where e.id = p_id);
  elsif p_type = 'expense' then
    return (select x.organization_id from public.org_expenses x where x.id = p_id);
  end if;
  return null;
end;
$$;

create or replace function private.entity_visible(p_type text, p_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e public.org_entries;
  x public.org_expenses;
begin
  if p_type = 'entry' then
    select * into e from public.org_entries where id = p_id;
    return found and (private.sees_org_finance(e.organization_id)
      or (e.structure_id is not null and private.views_structure_money(e.structure_id)));
  elsif p_type = 'expense' then
    select * into x from public.org_expenses where id = p_id;
    return found and private.expense_visible(x);
  end if;
  return false;
end;
$$;

create or replace function private.entity_attachable(p_type text, p_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e public.org_entries;
  x public.org_expenses;
begin
  if p_type = 'entry' then
    select * into e from public.org_entries where id = p_id;
    return found and (private.has_org_role(e.organization_id,
        array['org_admin', 'finance_admin']::public.org_role[])
      or (e.structure_id is not null and private.handles_structure_money(e.structure_id)));
  elsif p_type = 'expense' then
    select * into x from public.org_expenses where id = p_id;
    return found and x.status not in ('rejected', 'cancelled')
      and (x.requested_by = private.active_uid() or private.expense_payer(x));
  end if;
  return false;
end;
$$;

revoke all on function
  public.org_expense_submit(text, public.org_account, uuid, text, text, text, integer),
  public.org_expense_verify(uuid, boolean, text),
  public.org_expense_reply(uuid, text, integer),
  public.org_expense_decide(uuid, text, integer, text),
  public.org_expense_commit(uuid, text),
  public.org_expense_pay(uuid, integer, public.org_payment_method, text, text),
  public.org_expense_justify(uuid, integer, text),
  public.org_expense_cancel(uuid, text),
  public.org_expenses_page(text, public.org_expense_status, uuid, text, integer),
  public.org_expense_view(uuid),
  public.organization_balances(text)
  from public, anon;
grant execute on function
  public.org_expense_submit(text, public.org_account, uuid, text, text, text, integer),
  public.org_expense_verify(uuid, boolean, text),
  public.org_expense_reply(uuid, text, integer),
  public.org_expense_decide(uuid, text, integer, text),
  public.org_expense_commit(uuid, text),
  public.org_expense_pay(uuid, integer, public.org_payment_method, text, text),
  public.org_expense_justify(uuid, integer, text),
  public.org_expense_cancel(uuid, text),
  public.org_expenses_page(text, public.org_expense_status, uuid, text, integer),
  public.org_expense_view(uuid),
  public.organization_balances(text)
  to authenticated;
