-- Financements des membres (cahier § 10) et projets / réalisations (cahier § 11).
--
-- Financement : dépôt par le militant → vérification administrative → évaluation
-- (assiduité 40 points calculée + qualité du projet 60 points) → décision du comité
-- (autorité de validation ou administration générale) → décaissement (administration
-- financière) → remboursements éventuels → rapport final et clôture.
-- La note est une aide à la décision : le comité décide librement, avec justification.
-- Séparation des fonctions : le demandeur ne traite pas son dossier, l'évaluateur ne
-- décide pas, celui qui décide ne décaisse pas.

create type public.org_financing_status as enum (
  'submitted', 'incomplete', 'checked', 'evaluated', 'approved', 'rejected', 'active',
  'closed', 'withdrawn'
);
create type public.org_project_status as enum (
  'submitted', 'studying', 'approved', 'in_progress', 'suspended', 'completed', 'closed'
);

create table public.org_financings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  number text not null unique,
  user_id uuid not null references public.profiles (id) on delete restrict,
  structure_id uuid not null references public.org_structures (id) on delete restrict,
  nature text not null check (nature in ('aide_sociale', 'pret', 'projet_economique',
    'soutien_exceptionnel', 'initiative_collective')),
  title text not null check (char_length(btrim(title)) between 3 and 120),
  description text not null check (char_length(btrim(description)) between 10 and 3000),
  amount_requested integer not null check (amount_requested between 1000 and 100000000),
  budget text check (char_length(budget) <= 3000),
  duration_months integer check (duration_months between 1 and 120),
  objectives text check (char_length(objectives) <= 2000),
  beneficiaries text check (char_length(beneficiaries) <= 1000),
  status public.org_financing_status not null default 'submitted',
  checked_by uuid references public.profiles (id) on delete set null,
  checked_at timestamptz,
  -- Évaluation (§ 10.3).
  assiduity_score integer check (assiduity_score between 0 and 40),
  scores jsonb,
  project_score integer check (project_score between 0 and 60),
  evaluation_note text check (char_length(evaluation_note) <= 2000),
  social_note text check (char_length(social_note) <= 1000),
  evaluated_by uuid references public.profiles (id) on delete set null,
  evaluated_at timestamptz,
  -- Décision.
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  decision_note text check (char_length(decision_note) <= 2000),
  amount_granted integer check (amount_granted between 1000 and 100000000),
  conditions text check (char_length(conditions) <= 2000),
  is_loan boolean not null default false,
  -- Caisse qui finance : fonds commun ou caisse de la structure.
  funding_account public.org_account check (funding_account in ('structure', 'common')),
  funding_structure uuid references public.org_structures (id) on delete restrict,
  amount_disbursed integer not null default 0 check (amount_disbursed >= 0),
  amount_repaid integer not null default 0 check (amount_repaid >= 0),
  final_report text check (char_length(final_report) <= 5000),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint org_financings_disbursed check (amount_disbursed <= coalesce(amount_granted, 0))
);

create index org_financings_org_idx on public.org_financings (organization_id, status, created_at desc);
create index org_financings_user_idx on public.org_financings (user_id);

create trigger org_financings_updated_at
  before update on public.org_financings
  for each row execute function private.set_updated_at();

create table public.org_financing_events (
  id uuid primary key default gen_random_uuid(),
  financing_id uuid not null references public.org_financings (id) on delete cascade,
  status public.org_financing_status not null,
  actor_id uuid references public.profiles (id) on delete set null,
  amount integer,
  note text check (char_length(note) <= 2000),
  at timestamptz not null default now()
);

create index org_financing_events_idx on public.org_financing_events (financing_id, at);

create trigger org_financing_events_append_only
  before update or delete on public.org_financing_events
  for each row when (pg_trigger_depth() = 0)
  execute function private.forbid_change();

-- Échéancier de remboursement (prêts).
create table public.org_financing_repayments (
  id uuid primary key default gen_random_uuid(),
  financing_id uuid not null references public.org_financings (id) on delete cascade,
  due_date date not null,
  amount_due integer not null check (amount_due > 0),
  amount_paid integer not null default 0 check (amount_paid >= 0),
  paid_at timestamptz,
  constraint org_repayments_not_over check (amount_paid <= amount_due)
);

create index org_financing_repayments_idx on public.org_financing_repayments (financing_id, due_date);

create table public.org_projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  structure_id uuid not null references public.org_structures (id) on delete restrict,
  financing_id uuid references public.org_financings (id) on delete set null,
  title text not null check (char_length(btrim(title)) between 3 and 120),
  manager_name text check (char_length(manager_name) <= 80),
  manager_id uuid references public.profiles (id) on delete set null,
  objectives text check (char_length(objectives) <= 2000),
  budget integer check (budget between 0 and 1000000000),
  funding_sources text check (char_length(funding_sources) <= 500),
  start_date date,
  end_date date,
  schedule text check (char_length(schedule) <= 2000),
  beneficiaries text check (char_length(beneficiaries) <= 1000),
  status public.org_project_status not null default 'submitted',
  expected_results text check (char_length(expected_results) <= 2000),
  obtained_results text check (char_length(obtained_results) <= 3000),
  progress integer not null default 0 check (progress between 0 and 100),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint org_projects_dates check (end_date is null or start_date is null or end_date >= start_date)
);

create index org_projects_org_idx on public.org_projects (organization_id, status);

create trigger org_projects_updated_at
  before update on public.org_projects
  for each row execute function private.set_updated_at();

-- Réalisations : comptes rendus d'avancement datés.
create table public.org_project_updates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.org_projects (id) on delete cascade,
  status public.org_project_status,
  progress integer check (progress between 0 and 100),
  note text not null check (char_length(btrim(note)) between 3 and 2000),
  author_id uuid references public.profiles (id) on delete set null,
  at timestamptz not null default now()
);

create index org_project_updates_idx on public.org_project_updates (project_id, at desc);

alter table public.org_entries
  add column financing_id uuid references public.org_financings (id) on delete restrict;
create index org_entries_financing_idx on public.org_entries (financing_id);

alter table public.org_financings enable row level security;
alter table public.org_financing_events enable row level security;
alter table public.org_financing_repayments enable row level security;
alter table public.org_projects enable row level security;
alter table public.org_project_updates enable row level security;
revoke all on public.org_financings, public.org_financing_events, public.org_financing_repayments,
  public.org_projects, public.org_project_updates from anon, authenticated;

-- Financements accordés non encore décaissés : engagés sur la caisse qui finance.
create or replace function private.account_engaged(
  p_org uuid, p_account public.org_account, p_structure uuid default null
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select sum(x.amount_approved - x.amount_paid) from public.org_expenses x
    where x.organization_id = p_org and x.account = p_account
      and (p_account <> 'structure' or x.structure_id = p_structure)
      and x.status in ('approved', 'committed')), 0)
  + coalesce((
    select sum(f.amount_granted - f.amount_disbursed) from public.org_financings f
    where f.organization_id = p_org and f.funding_account = p_account
      and (p_account <> 'structure' or f.funding_structure = p_structure)
      and f.status in ('approved', 'active')), 0)
$$;

-- ---------------------------------------------------------------------------
-- Assiduité (§ 10.3 A et § 7.3) : échéances exigibles payées à temps.
-- ---------------------------------------------------------------------------

create or replace function private.member_assiduity(p_org uuid, p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'due', count(*),
    'onTime', count(*) filter (where i.paid_at is not null
                               and (i.paid_at at time zone 'Africa/Dakar')::date <= i.due_date),
    'late', count(*) filter (where i.paid_at is null or
                             (i.paid_at at time zone 'Africa/Dakar')::date > i.due_date),
    'rate', case when count(*) = 0 then null else round(100.0 * count(*) filter (
      where i.paid_at is not null and (i.paid_at at time zone 'Africa/Dakar')::date <= i.due_date)
      / count(*)) end,
    'score', case when count(*) = 0 then 40 else round(40.0 * count(*) filter (
      where i.paid_at is not null and (i.paid_at at time zone 'Africa/Dakar')::date <= i.due_date)
      / count(*)) end
  )
  from public.org_installments i
  join public.org_funds f on f.id = i.fund_id
  join public.org_structures s on s.id = f.structure_id
  where s.organization_id = p_org and i.user_id = p_user and i.exempted_at is null
    and i.due_date < current_date
$$;

-- ---------------------------------------------------------------------------
-- Droits et outils
-- ---------------------------------------------------------------------------

create or replace function private.require_financing(p_id uuid)
returns public.org_financings
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f public.org_financings;
begin
  select * into f from public.org_financings where id = p_id;
  if not found then
    raise exception 'Cette demande de financement est introuvable.' using errcode = 'P0002';
  end if;
  return f;
end;
$$;

create or replace function private.financing_visible(f public.org_financings)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select f.user_id = private.active_uid() or private.sees_org_finance(f.organization_id)
$$;

create or replace function private.financing_event(
  p_id uuid, p_status public.org_financing_status, p_actor uuid, p_amount integer, p_note text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.org_financing_events (financing_id, status, actor_id, amount, note)
  values (p_id, p_status, p_actor, p_amount, p_note);
$$;

create or replace function private.financing_notify(f public.org_financings, p_text text)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.notify(f.user_id, 'organization',
    (select o.short_name from public.organizations o where o.id = f.organization_id)
      || ' – Financement',
    format('Demande %s : %s', f.number, p_text),
    '/espace/' || (select o.slug from public.organizations o where o.id = f.organization_id)
      || '/financements/' || f.id)
$$;

-- ---------------------------------------------------------------------------
-- Étapes du financement
-- ---------------------------------------------------------------------------

create or replace function public.org_financing_submit(
  p_slug text,
  p_structure uuid,
  p_nature text,
  p_title text,
  p_description text,
  p_amount integer,
  p_budget text,
  p_duration integer,
  p_objectives text,
  p_beneficiaries text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  o public.organizations := private.require_org_by_slug(p_slug);
  settings jsonb := private.org_settings(o.id);
  v_title text := private.clean_text('title', p_title, 120);
  v_description text := private.clean_text('description', p_description, 3000);
  v_id uuid;
  v_number text;
begin
  if not exists (
    select 1 from public.structure_members sm
    join public.org_structures s on s.id = sm.structure_id
    where sm.user_id = uid and sm.structure_id = p_structure and sm.status = 'active'
      and s.organization_id = o.id
  ) then
    raise exception 'Choisissez une structure dont vous êtes membre actif.' using errcode = '22023';
  end if;
  if p_nature not in ('aide_sociale', 'pret', 'projet_economique', 'soutien_exceptionnel',
                      'initiative_collective') then
    raise exception 'Choisissez la nature de la demande.' using errcode = '22023';
  end if;
  if v_title is null or char_length(v_title) < 3 then
    raise exception 'Donnez un titre à votre demande.' using errcode = '22023';
  end if;
  if v_description is null or char_length(v_description) < 10 then
    raise exception 'Décrivez votre demande (10 caractères au moins).' using errcode = '22023';
  end if;
  if coalesce(p_amount, 0) < 1000 or p_amount > (settings ->> 'financingMaxAmount')::integer then
    raise exception 'Le montant doit être compris entre 1 000 FCFA et %.',
      private.format_amount((settings ->> 'financingMaxAmount')::integer) using errcode = '22023';
  end if;
  if p_duration is not null and (p_duration < 1
       or p_duration > (settings ->> 'financingMaxMonths')::integer) then
    raise exception 'Durée de réalisation : % mois au plus.',
      settings ->> 'financingMaxMonths' using errcode = '22023';
  end if;
  if exists (select 1 from public.org_financings f where f.user_id = uid and f.organization_id = o.id
             and f.status in ('submitted', 'incomplete', 'checked', 'evaluated')) then
    raise exception 'Vous avez déjà une demande en cours d’examen.' using errcode = '23505';
  end if;

  v_number := private.next_number(o.id, 'F');
  insert into public.org_financings (organization_id, number, user_id, structure_id, nature,
    title, description, amount_requested, budget, duration_months, objectives, beneficiaries)
  values (o.id, v_number, uid, p_structure, p_nature, v_title, v_description, p_amount,
    private.clean_text('budget', p_budget, 3000), p_duration,
    private.clean_text('objectives', p_objectives, 2000),
    private.clean_text('beneficiaries', p_beneficiaries, 1000))
  returning id into v_id;
  perform private.financing_event(v_id, 'submitted', uid, p_amount, null);

  perform private.notify(r.user_id, 'organization', o.short_name || ' – Financements',
    format('Nouvelle demande de financement %s : « %s » (%s).', v_number, v_title,
      private.format_amount(p_amount)),
    '/espace/' || o.slug || '/financements/' || v_id)
  from (select distinct r.user_id from public.organization_roles r
        where r.organization_id = o.id and r.role in ('projects_manager', 'org_admin')
          and r.user_id <> uid) r;
  perform private.audit(uid, 'org_financing_submitted',
    format('a déposé la demande de financement %s (%s)', v_number, private.format_amount(p_amount)));
  return v_id;
end;
$$;

-- Le demandeur complète un dossier incomplet ou retire sa demande.
create or replace function public.org_financing_member_action(p_id uuid, p_action text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.org_financings := private.require_financing(p_id);
  uid uuid := private.require_uid();
  v_note text := private.clean_text('note', p_note, 2000);
begin
  if f.user_id <> uid then
    raise exception 'Seul le demandeur agit sur sa demande.' using errcode = '42501',
      hint = 'access_denied:financing';
  end if;
  if p_action = 'complete' and f.status = 'incomplete' then
    if v_note is null then
      raise exception 'Indiquez ce que vous avez complété.' using errcode = '22023';
    end if;
    update public.org_financings set status = 'submitted' where id = f.id;
    perform private.financing_event(f.id, 'submitted', uid, null, v_note);
  elsif p_action = 'withdraw' and f.status in ('submitted', 'incomplete', 'checked', 'evaluated') then
    update public.org_financings set status = 'withdrawn' where id = f.id;
    perform private.financing_event(f.id, 'withdrawn', uid, null, v_note);
  else
    raise exception 'Action impossible à cette étape.' using errcode = '22023';
  end if;
end;
$$;

-- Vérification administrative : dossier complet ou à compléter.
create or replace function public.org_financing_check(p_id uuid, p_ok boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.org_financings := private.require_financing(p_id);
  uid uuid := private.require_org_roles(f.organization_id,
    array['org_admin', 'projects_manager', 'finance_admin']::public.org_role[],
    'Réservé au responsable des projets ou à l’administration.');
  v_note text := private.clean_text('note', p_note, 2000);
begin
  if f.status <> 'submitted' then
    raise exception 'Ce dossier n’attend pas de vérification.' using errcode = '22023';
  end if;
  if f.user_id = uid then
    raise exception 'Vous ne pouvez pas traiter votre propre demande.'
      using errcode = '42501', hint = 'access_denied:separation';
  end if;
  if p_ok then
    update public.org_financings set status = 'checked', checked_by = uid, checked_at = now()
    where id = f.id;
    perform private.financing_event(f.id, 'checked', uid, null, v_note);
    perform private.financing_notify(f, 'dossier complet, en cours d’évaluation.');
  else
    v_note := private.require_note(p_note, 'Indiquez ce qui manque au dossier.');
    update public.org_financings set status = 'incomplete' where id = f.id;
    perform private.financing_event(f.id, 'incomplete', uid, null, v_note);
    perform private.financing_notify(f, 'dossier à compléter. ' || v_note);
  end if;
end;
$$;

-- Évaluation : assiduité calculée (40) + 6 critères (60). Réévaluable avant décision.
create or replace function public.org_financing_evaluate(
  p_id uuid, p_scores jsonb, p_note text, p_social_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.org_financings := private.require_financing(p_id);
  uid uuid := private.require_org_roles(f.organization_id,
    array['org_admin', 'projects_manager', 'finance_admin']::public.org_role[],
    'Réservé au responsable des projets ou à l’administration.');
  maxima jsonb := '{"pertinence": 15, "viabilite": 15, "faisabilite": 10, "impact": 10,
                    "budget": 5, "capacite": 5}';
  k text;
  v integer;
  total integer := 0;
  clean jsonb := '{}';
  assiduity jsonb := private.member_assiduity(f.organization_id, f.user_id);
begin
  if f.status not in ('checked', 'evaluated') then
    raise exception 'Le dossier doit être vérifié avant l’évaluation.' using errcode = '22023';
  end if;
  if f.user_id = uid then
    raise exception 'Vous ne pouvez pas évaluer votre propre demande.'
      using errcode = '42501', hint = 'access_denied:separation';
  end if;
  for k in select jsonb_object_keys(maxima) loop
    v := (p_scores ->> k)::integer;
    if v is null or v < 0 or v > (maxima ->> k)::integer then
      raise exception 'Note « % » : entre 0 et %.', k, maxima ->> k using errcode = '22023';
    end if;
    clean := clean || jsonb_build_object(k, v);
    total := total + v;
  end loop;
  update public.org_financings
  set status = 'evaluated', scores = clean, project_score = total,
      assiduity_score = (assiduity ->> 'score')::integer,
      evaluation_note = private.clean_text('note', p_note, 2000),
      social_note = private.clean_text('social', p_social_note, 1000),
      evaluated_by = uid, evaluated_at = now()
  where id = f.id;
  perform private.financing_event(f.id, 'evaluated', uid, null,
    format('Note : %s/100 (assiduité %s/40, projet %s/60)',
      total + (assiduity ->> 'score')::integer, assiduity ->> 'score', total));
  perform private.notify(r.user_id, 'organization',
    (select o.short_name from public.organizations o where o.id = f.organization_id) || ' – Financements',
    format('Demande %s évaluée : en attente de la décision du comité.', f.number),
    '/espace/' || (select o.slug from public.organizations o where o.id = f.organization_id)
      || '/financements/' || f.id)
  from (select distinct r.user_id from public.organization_roles r
        where r.organization_id = f.organization_id and r.role in ('validator', 'org_admin')
          and r.user_id <> uid) r;
  return jsonb_build_object('assiduity', (assiduity ->> 'score')::integer, 'project', total);
end;
$$;

-- Décision du comité. Accord : montant, conditions, caisse qui finance, échéancier
-- de remboursement s'il s'agit d'un prêt. Un projet est ouvert pour les projets
-- économiques et les initiatives collectives.
create or replace function public.org_financing_decide(
  p_id uuid,
  p_approve boolean,
  p_amount integer,
  p_conditions text,
  p_account public.org_account,
  p_structure uuid,
  p_is_loan boolean,
  p_repayment_count integer,
  p_first_due date,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.org_financings := private.require_financing(p_id);
  uid uuid := private.require_org_roles(f.organization_id,
    array['validator', 'org_admin']::public.org_role[],
    'La décision revient au comité (autorité de validation ou administration générale).');
  v_note text := private.require_note(p_note, 'Motivez la décision.');
  v_conditions text := private.clean_text('conditions', p_conditions, 2000);
  i integer;
  part integer;
  v_structure uuid := case when p_account = 'structure' then coalesce(p_structure, f.structure_id) end;
begin
  if f.status <> 'evaluated' then
    raise exception 'Le dossier doit être évalué avant la décision.' using errcode = '22023';
  end if;
  if f.user_id = uid or f.evaluated_by = uid then
    raise exception 'Vous avez déposé ou évalué ce dossier : une autre personne décide.'
      using errcode = '42501', hint = 'access_denied:separation';
  end if;

  if not p_approve then
    update public.org_financings
    set status = 'rejected', decided_by = uid, decided_at = now(), decision_note = v_note
    where id = f.id;
    perform private.financing_event(f.id, 'rejected', uid, null, v_note);
    perform private.financing_notify(f, 'demande non retenue. ' || v_note);
    perform private.audit(uid, 'org_financing_decided',
      format('a rejeté la demande de financement %s', f.number));
    return;
  end if;

  if coalesce(p_amount, 0) < 1000 or p_amount > f.amount_requested then
    raise exception 'Le montant accordé doit être compris entre 1 000 FCFA et le montant demandé.'
      using errcode = '22023';
  end if;
  if p_account not in ('structure', 'common') then
    raise exception 'Choisissez la caisse qui finance.' using errcode = '22023';
  end if;
  if private.account_available(f.organization_id, p_account, v_structure) < p_amount then
    raise exception 'Ressources insuffisantes dans la caisse qui finance.' using errcode = '22023';
  end if;
  if coalesce(p_is_loan, false) and (coalesce(p_repayment_count, 0) not between 1 and 60
                                     or p_first_due is null or p_first_due <= current_date) then
    raise exception 'Prêt : indiquez le nombre d’échéances (1 à 60) et une première échéance future.'
      using errcode = '22023';
  end if;

  update public.org_financings
  set status = 'approved', decided_by = uid, decided_at = now(), decision_note = v_note,
      amount_granted = p_amount, conditions = v_conditions, is_loan = coalesce(p_is_loan, false),
      funding_account = p_account, funding_structure = v_structure
  where id = f.id;

  if coalesce(p_is_loan, false) then
    for i in 0 .. p_repayment_count - 1 loop
      part := p_amount / p_repayment_count
        + case when i = p_repayment_count - 1 then p_amount % p_repayment_count else 0 end;
      insert into public.org_financing_repayments (financing_id, due_date, amount_due)
      values (f.id, (p_first_due + make_interval(months => i))::date, part);
    end loop;
  end if;

  if f.nature in ('projet_economique', 'initiative_collective') then
    insert into public.org_projects (organization_id, structure_id, financing_id, title,
      manager_id, manager_name, objectives, budget, funding_sources, beneficiaries, status,
      created_by)
    values (f.organization_id, f.structure_id, f.id, f.title, f.user_id,
      private.full_name(f.user_id), f.objectives, p_amount,
      'Financement ' || f.number, f.beneficiaries, 'approved', uid);
  end if;

  perform private.financing_event(f.id, 'approved', uid, p_amount, v_note);
  perform private.financing_notify(f, format('financement accordé : %s. %s',
    private.format_amount(p_amount), coalesce(v_conditions, '')));
  perform private.audit(uid, 'org_financing_decided',
    format('a accordé %s pour la demande %s', private.format_amount(p_amount), f.number));
end;
$$;

-- Décaissement (administration financière, pas celui qui a décidé).
create or replace function public.org_financing_disburse(
  p_id uuid, p_amount integer, p_method public.org_payment_method, p_reference text, p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.org_financings := private.require_financing(p_id);
  uid uuid := private.require_org_roles(f.organization_id,
    array['finance_admin']::public.org_role[],
    'Le décaissement est fait par l’administration financière.');
  v_reference text := private.clean_text('reference', p_reference, 80);
  v_entry uuid;
begin
  if f.status not in ('approved', 'active') then
    raise exception 'Ce financement n’est pas à décaisser.' using errcode = '22023';
  end if;
  if f.decided_by = uid then
    raise exception 'Vous avez décidé ce financement : une autre personne décaisse.'
      using errcode = '42501', hint = 'access_denied:separation';
  end if;
  if coalesce(p_amount, 0) <= 0 or f.amount_disbursed + p_amount > f.amount_granted then
    raise exception 'Reste à décaisser : %.',
      private.format_amount(f.amount_granted - f.amount_disbursed) using errcode = '22023';
  end if;
  if p_method is null then
    raise exception 'Indiquez le mode de paiement.' using errcode = '22023';
  end if;
  perform private.check_reference(f.organization_id, p_method, v_reference);
  if private.account_balance(f.organization_id, f.funding_account, f.funding_structure) < p_amount then
    raise exception 'Solde insuffisant dans la caisse qui finance.' using errcode = '22023';
  end if;
  v_entry := private.entry_create(f.organization_id, 'decaissement', p_amount,
    format('Financement %s – %s', f.number, private.full_name(f.user_id)),
    jsonb_build_object('structure_id', f.structure_id, 'financing_id', f.id,
      'source_user', f.user_id, 'origin', private.full_name(f.user_id), 'method', p_method,
      'reference', v_reference, 'note', private.clean_text('note', p_note, 300),
      'validated_by', f.decided_by));
  perform private.entry_move(v_entry, f.funding_account, f.funding_structure,
    'treasury', null, p_amount);
  update public.org_financings
  set status = 'active', amount_disbursed = amount_disbursed + p_amount
  where id = f.id;
  update public.org_projects set status = 'in_progress'
  where financing_id = f.id and status = 'approved';
  perform private.financing_event(f.id, 'active', uid, p_amount, 'Décaissement');
  perform private.financing_notify(f, format('%s décaissés.', private.format_amount(p_amount)));
  perform private.audit(uid, 'org_financing_paid',
    format('a décaissé %s pour le financement %s', private.format_amount(p_amount), f.number));
  return v_entry;
end;
$$;

-- Remboursement d'un prêt : revient dans la caisse qui a financé.
create or replace function public.org_financing_repay(
  p_id uuid, p_amount integer, p_method public.org_payment_method, p_reference text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.org_financings := private.require_financing(p_id);
  uid uuid := private.require_org_roles(f.organization_id,
    array['finance_admin', 'org_admin']::public.org_role[],
    'Réservé à l’administration financière.');
  v_reference text := private.clean_text('reference', p_reference, 80);
  v_left integer := coalesce(p_amount, 0);
  v_open integer;
  r public.org_financing_repayments;
  part integer;
  v_entry uuid;
begin
  if not f.is_loan or f.status <> 'active' then
    raise exception 'Aucun remboursement attendu pour ce financement.' using errcode = '22023';
  end if;
  select coalesce(sum(x.amount_due - x.amount_paid), 0) into v_open
  from public.org_financing_repayments x where x.financing_id = f.id;
  if v_left <= 0 or v_left > v_open then
    raise exception 'Reste à rembourser : %.', private.format_amount(v_open) using errcode = '22023';
  end if;
  if p_method is null then
    raise exception 'Indiquez le mode de paiement.' using errcode = '22023';
  end if;
  perform private.check_reference(f.organization_id, p_method, v_reference);
  v_entry := private.entry_create(f.organization_id, 'remboursement', p_amount,
    format('Remboursement %s – %s', f.number, private.full_name(f.user_id)),
    jsonb_build_object('structure_id', f.structure_id, 'financing_id', f.id,
      'source_kind', 'membre', 'source_user', f.user_id, 'origin', private.full_name(f.user_id),
      'method', p_method, 'reference', v_reference, 'validated_by', uid));
  perform private.entry_move(v_entry, 'treasury', null, f.funding_account, f.funding_structure,
    p_amount);
  for r in select * from public.org_financing_repayments x
           where x.financing_id = f.id and x.amount_paid < x.amount_due
           order by x.due_date for update loop
    exit when v_left <= 0;
    part := least(v_left, r.amount_due - r.amount_paid);
    update public.org_financing_repayments
    set amount_paid = amount_paid + part,
        paid_at = case when amount_paid + part >= amount_due then now() end
    where id = r.id;
    v_left := v_left - part;
  end loop;
  update public.org_financings set amount_repaid = amount_repaid + p_amount where id = f.id;
  perform private.financing_event(f.id, 'active', uid, p_amount, 'Remboursement');
  perform private.financing_notify(f, format('remboursement de %s enregistré.',
    private.format_amount(p_amount)));
  return v_entry;
end;
$$;

-- Rapport final et clôture du dossier.
create or replace function public.org_financing_close(p_id uuid, p_report text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.org_financings := private.require_financing(p_id);
  uid uuid := private.require_org_roles(f.organization_id,
    array['org_admin', 'projects_manager']::public.org_role[],
    'Réservé au responsable des projets ou à l’administration générale.');
  v_report text := private.clean_text('report', p_report, 5000);
begin
  if f.status <> 'active' then
    raise exception 'Seul un financement en cours se clôture.' using errcode = '22023';
  end if;
  if v_report is null or char_length(v_report) < 10 then
    raise exception 'Rédigez le rapport d’exécution (10 caractères au moins).' using errcode = '22023';
  end if;
  update public.org_financings set status = 'closed', final_report = v_report, closed_at = now()
  where id = f.id;
  perform private.financing_event(f.id, 'closed', uid, null, 'Rapport final déposé');
end;
$$;

-- ---------------------------------------------------------------------------
-- Lectures des financements
-- ---------------------------------------------------------------------------

create or replace function private.financing_json(f public.org_financings)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', f.id, 'number', f.number, 'userId', f.user_id,
    'applicant', private.full_name(f.user_id),
    'memberNumber', (select m.member_number from public.organization_members m
                     where m.organization_id = f.organization_id and m.user_id = f.user_id),
    'structureId', f.structure_id,
    'structureName', (select s.name from public.org_structures s where s.id = f.structure_id),
    'nature', f.nature, 'title', f.title, 'status', f.status,
    'amountRequested', f.amount_requested, 'amountGranted', f.amount_granted,
    'amountDisbursed', f.amount_disbursed, 'amountRepaid', f.amount_repaid,
    'isLoan', f.is_loan, 'assiduityScore', f.assiduity_score, 'projectScore', f.project_score,
    'createdAt', f.created_at, 'decidedAt', f.decided_at
  )
$$;

create or replace function public.org_financings_page(
  p_slug text, p_status public.org_financing_status, p_query text, p_offset integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.organizations := private.require_org_by_slug(p_slug);
  uid uuid := private.require_sees_finance(o.id);
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  return (
    with filtered as (
      select f.* from public.org_financings f
      join public.profiles p on p.id = f.user_id
      where f.organization_id = o.id and (p_status is null or f.status = p_status)
        and (v_query is null or f.number ilike '%' || v_query || '%'
             or f.title ilike '%' || v_query || '%'
             or (p.first_name || ' ' || p.last_name) ilike '%' || v_query || '%')
    )
    select jsonb_build_object(
      'rows', coalesce((
        select jsonb_agg(private.financing_json(x) order by x.created_at desc)
        from (select * from filtered order by created_at desc offset v_offset limit 50) x
      ), '[]'::jsonb),
      'total', (select count(*) from filtered),
      'pageSize', 50,
      'summary', jsonb_build_object(
        'pending', (select count(*) from filtered
                    where status in ('submitted', 'incomplete', 'checked', 'evaluated')),
        'granted', (select coalesce(sum(amount_granted), 0) from filtered
                    where status in ('approved', 'active', 'closed')),
        'disbursed', (select coalesce(sum(amount_disbursed), 0) from filtered),
        'repaid', (select coalesce(sum(amount_repaid), 0) from filtered)
      )
    )
  );
end;
$$;

create or replace function public.my_financings(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  o public.organizations := private.require_org_by_slug(p_slug);
begin
  return jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(private.financing_json(f) order by f.created_at desc)
      from public.org_financings f where f.organization_id = o.id and f.user_id = uid
    ), '[]'::jsonb),
    'assiduity', private.member_assiduity(o.id, uid),
    'settings', jsonb_build_object(
      'maxAmount', (private.org_settings(o.id) ->> 'financingMaxAmount')::integer,
      'maxMonths', (private.org_settings(o.id) ->> 'financingMaxMonths')::integer),
    'structures', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.name)
      from public.structure_members sm join public.org_structures s on s.id = sm.structure_id
      where sm.user_id = uid and sm.status = 'active' and s.organization_id = o.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.org_financing_view(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f public.org_financings := private.require_financing(p_id);
  uid uuid := private.require_uid();
  central boolean := private.sees_org_finance(f.organization_id);
  handles boolean := private.has_org_role(f.organization_id,
    array['org_admin', 'projects_manager', 'finance_admin']::public.org_role[]);
begin
  if not private.financing_visible(f) then
    raise exception 'Accès refusé.' using errcode = '42501', hint = 'access_denied:financing';
  end if;
  return private.financing_json(f) || jsonb_build_object(
    'description', f.description, 'budget', f.budget, 'durationMonths', f.duration_months,
    'objectives', f.objectives, 'beneficiaries', f.beneficiaries,
    'scores', f.scores, 'evaluationNote', case when central then f.evaluation_note end,
    'socialNote', case when central then f.social_note end,
    'decisionNote', f.decision_note, 'conditions', f.conditions,
    'fundingAccount', f.funding_account,
    'fundingStructureName', (select s.name from public.org_structures s
                             where s.id = f.funding_structure),
    'finalReport', f.final_report, 'closedAt', f.closed_at,
    'assiduity', case when central then private.member_assiduity(f.organization_id, f.user_id) end,
    'commonAvailable', case when central then
      private.account_available(f.organization_id, 'common') end,
    'structureAvailable', case when central then
      private.account_available(f.organization_id, 'structure', f.structure_id) end,
    'repayments', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'dueDate', r.due_date,
        'amountDue', r.amount_due, 'amountPaid', r.amount_paid, 'paidAt', r.paid_at)
        order by r.due_date)
      from public.org_financing_repayments r where r.financing_id = f.id
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('status', e.status, 'actor',
        case when central or e.actor_id = uid then private.full_name(e.actor_id) end,
        'amount', e.amount, 'note', e.note, 'at', e.at) order by e.at)
      from public.org_financing_events e where e.financing_id = f.id
    ), '[]'::jsonb),
    'projectId', (select p.id from public.org_projects p where p.financing_id = f.id limit 1),
    'documents', private.documents_json('financing', f.id),
    'can', jsonb_build_object(
      'check', f.status = 'submitted' and handles and f.user_id <> uid,
      'evaluate', f.status in ('checked', 'evaluated') and handles and f.user_id <> uid,
      'decide', f.status = 'evaluated' and f.user_id <> uid and f.evaluated_by is distinct from uid
        and private.has_org_role(f.organization_id, array['validator', 'org_admin']::public.org_role[]),
      'disburse', f.status in ('approved', 'active') and f.amount_disbursed < f.amount_granted
        and f.decided_by is distinct from uid
        and private.has_org_role(f.organization_id, array['finance_admin']::public.org_role[]),
      'repay', f.status = 'active' and f.is_loan and f.amount_repaid < f.amount_granted
        and private.has_org_role(f.organization_id, array['finance_admin', 'org_admin']::public.org_role[]),
      'close', f.status = 'active'
        and private.has_org_role(f.organization_id, array['org_admin', 'projects_manager']::public.org_role[]),
      'complete', f.status = 'incomplete' and f.user_id = uid,
      'withdraw', f.status in ('submitted', 'incomplete', 'checked', 'evaluated') and f.user_id = uid,
      'attach', f.status not in ('rejected', 'withdrawn', 'closed') and (f.user_id = uid or handles)
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Projets et réalisations
-- ---------------------------------------------------------------------------

create or replace function private.require_project(p_id uuid)
returns public.org_projects
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.org_projects;
begin
  select * into p from public.org_projects where id = p_id;
  if not found then
    raise exception 'Ce projet est introuvable.' using errcode = 'P0002';
  end if;
  return p;
end;
$$;

-- Gère le projet : responsable des projets, admin général, responsables de la structure
-- porteuse, chef de projet.
create or replace function private.project_editable(p public.org_projects)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_org_role(p.organization_id,
      array['org_admin', 'projects_manager']::public.org_role[])
    or private.manages_structure(p.structure_id)
    or p.manager_id = private.active_uid()
$$;

-- Les militants voient les projets de leurs structures une fois approuvés.
create or replace function private.project_visible(p public.org_projects)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.sees_org_finance(p.organization_id) or private.project_editable(p)
    or (p.status not in ('submitted', 'studying') and exists (
      select 1 from public.structure_members sm
      where sm.user_id = private.active_uid() and sm.status = 'active'
        and sm.structure_id in (select a.id from private.structure_ancestors(p.structure_id) a
                                union select p.structure_id)))
$$;

create or replace function public.org_project_save(
  p_slug text,
  p_id uuid,
  p_structure uuid,
  p_title text,
  p_manager_name text,
  p_objectives text,
  p_budget integer,
  p_funding_sources text,
  p_start date,
  p_end date,
  p_schedule text,
  p_beneficiaries text,
  p_expected text,
  p_obtained text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  o public.organizations := private.require_org_by_slug(p_slug);
  p public.org_projects;
  v_title text := private.clean_text('title', p_title, 120);
  v_id uuid := p_id;
begin
  if v_title is null or char_length(v_title) < 3 then
    raise exception 'Donnez un intitulé au projet.' using errcode = '22023';
  end if;
  if p_budget is not null and (p_budget < 0 or p_budget > 1000000000) then
    raise exception 'Budget invalide.' using errcode = '22023';
  end if;
  if p_start is not null and p_end is not null and p_end < p_start then
    raise exception 'La date de fin précède la date de début.' using errcode = '22023';
  end if;
  if p_id is null then
    if not exists (select 1 from public.org_structures s where s.id = p_structure
                   and s.organization_id = o.id) then
      raise exception 'Choisissez la structure porteuse.' using errcode = '22023';
    end if;
    if not (private.has_org_role(o.id, array['org_admin', 'projects_manager']::public.org_role[])
            or private.manages_structure(p_structure)) then
      raise exception 'Réservé aux responsables de la structure ou au responsable des projets.'
        using errcode = '42501', hint = 'access_denied:project';
    end if;
    insert into public.org_projects (organization_id, structure_id, title, manager_name,
      objectives, budget, funding_sources, start_date, end_date, schedule, beneficiaries,
      expected_results, obtained_results, created_by)
    values (o.id, p_structure, v_title, private.clean_text('manager', p_manager_name, 80),
      private.clean_text('objectives', p_objectives, 2000), p_budget,
      private.clean_text('sources', p_funding_sources, 500), p_start, p_end,
      private.clean_text('schedule', p_schedule, 2000),
      private.clean_text('beneficiaries', p_beneficiaries, 1000),
      private.clean_text('expected', p_expected, 2000),
      private.clean_text('obtained', p_obtained, 3000), uid)
    returning id into v_id;
    insert into public.org_project_updates (project_id, status, note, author_id)
    values (v_id, 'submitted', 'Projet soumis', uid);
  else
    p := private.require_project(p_id);
    if p.organization_id <> o.id or not private.project_editable(p) then
      raise exception 'Vous ne pouvez pas modifier ce projet.' using errcode = '42501',
        hint = 'access_denied:project';
    end if;
    if p.status = 'closed' then
      raise exception 'Ce projet est clôturé.' using errcode = '22023';
    end if;
    update public.org_projects
    set title = v_title, manager_name = private.clean_text('manager', p_manager_name, 80),
        objectives = private.clean_text('objectives', p_objectives, 2000), budget = p_budget,
        funding_sources = private.clean_text('sources', p_funding_sources, 500),
        start_date = p_start, end_date = p_end,
        schedule = private.clean_text('schedule', p_schedule, 2000),
        beneficiaries = private.clean_text('beneficiaries', p_beneficiaries, 1000),
        expected_results = private.clean_text('expected', p_expected, 2000),
        obtained_results = private.clean_text('obtained', p_obtained, 3000)
    where id = p.id;
  end if;
  perform private.audit(uid, 'org_project_saved',
    format('a %s le projet « %s »', case when p_id is null then 'créé' else 'modifié' end, v_title));
  return v_id;
end;
$$;

-- Compte rendu d'avancement ; changement de statut réservé au responsable des projets
-- et à l'administration générale.
create or replace function public.org_project_update(
  p_id uuid, p_status public.org_project_status, p_progress integer, p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.org_projects := private.require_project(p_id);
  uid uuid := private.require_uid();
  v_note text := private.require_note(p_note, 'Décrivez l’avancement ou la décision.');
  central boolean := private.has_org_role(p.organization_id,
    array['org_admin', 'projects_manager']::public.org_role[]);
begin
  if not private.project_editable(p) then
    raise exception 'Vous ne pouvez pas mettre à jour ce projet.' using errcode = '42501',
      hint = 'access_denied:project';
  end if;
  if p.status = 'closed' then
    raise exception 'Ce projet est clôturé.' using errcode = '22023';
  end if;
  if p_status is not null and p_status <> p.status and not central then
    raise exception 'Le statut est changé par le responsable des projets.'
      using errcode = '42501', hint = 'access_denied:project';
  end if;
  if p_progress is not null and (p_progress < 0 or p_progress > 100) then
    raise exception 'Avancement : entre 0 et 100 %%.' using errcode = '22023';
  end if;
  update public.org_projects
  set status = coalesce(p_status, status), progress = coalesce(p_progress, progress)
  where id = p.id;
  insert into public.org_project_updates (project_id, status, progress, note, author_id)
  values (p.id, case when p_status is distinct from p.status then p_status end, p_progress,
          v_note, uid);
end;
$$;

create or replace function private.project_json(p public.org_projects)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'title', p.title, 'structureId', p.structure_id,
    'structureName', (select s.name from public.org_structures s where s.id = p.structure_id),
    'financingId', p.financing_id, 'managerName', coalesce(p.manager_name,
      private.full_name(p.manager_id)),
    'budget', p.budget, 'status', p.status, 'progress', p.progress,
    'startDate', p.start_date, 'endDate', p.end_date, 'updatedAt', p.updated_at
  )
$$;

create or replace function public.org_projects_list(
  p_slug text, p_status public.org_project_status, p_structure uuid
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
begin
  return jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(private.project_json(p) order by p.updated_at desc)
      from public.org_projects p
      where p.organization_id = o.id and private.project_visible(p)
        and (p_status is null or p.status = p_status)
        and (p_structure is null or p.structure_id = p_structure)
    ), '[]'::jsonb),
    'canCreate', private.has_org_role(o.id, array['org_admin', 'projects_manager']::public.org_role[])
      or exists (select 1 from public.structure_roles r join public.org_structures s
                 on s.id = r.structure_id where r.user_id = uid and s.organization_id = o.id)
  );
end;
$$;

create or replace function public.org_project_view(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.org_projects := private.require_project(p_id);
  uid uuid := private.require_uid();
begin
  if not private.project_visible(p) then
    raise exception 'Accès refusé.' using errcode = '42501', hint = 'access_denied:project';
  end if;
  return private.project_json(p) || jsonb_build_object(
    'objectives', p.objectives, 'fundingSources', p.funding_sources, 'schedule', p.schedule,
    'beneficiaries', p.beneficiaries, 'expectedResults', p.expected_results,
    'obtainedResults', p.obtained_results,
    'spent', coalesce((select sum(e.amount) from public.org_entries e
      where e.financing_id = p.financing_id and e.nature = 'decaissement'
        and e.cancelled_at is null and p.financing_id is not null), 0),
    'updates', coalesce((
      select jsonb_agg(jsonb_build_object('status', u.status, 'progress', u.progress,
        'note', u.note, 'author', private.full_name(u.author_id), 'at', u.at) order by u.at desc)
      from public.org_project_updates u where u.project_id = p.id
    ), '[]'::jsonb),
    'documents', private.documents_json('project', p.id),
    'can', jsonb_build_object(
      'edit', p.status <> 'closed' and private.project_editable(p),
      'status', p.status <> 'closed' and private.has_org_role(p.organization_id,
        array['org_admin', 'projects_manager']::public.org_role[]),
      'attach', p.status <> 'closed' and private.project_editable(p)
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Pièces jointes : financements et projets
-- ---------------------------------------------------------------------------

create or replace function private.entity_org(p_type text, p_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return case p_type
    when 'entry' then (select e.organization_id from public.org_entries e where e.id = p_id)
    when 'expense' then (select x.organization_id from public.org_expenses x where x.id = p_id)
    when 'financing' then (select f.organization_id from public.org_financings f where f.id = p_id)
    when 'project' then (select p.organization_id from public.org_projects p where p.id = p_id)
  end;
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
  f public.org_financings;
  p public.org_projects;
begin
  if p_type = 'entry' then
    select * into e from public.org_entries where id = p_id;
    return found and (private.sees_org_finance(e.organization_id)
      or (e.structure_id is not null and private.views_structure_money(e.structure_id)));
  elsif p_type = 'expense' then
    select * into x from public.org_expenses where id = p_id;
    return found and private.expense_visible(x);
  elsif p_type = 'financing' then
    select * into f from public.org_financings where id = p_id;
    return found and private.financing_visible(f);
  elsif p_type = 'project' then
    select * into p from public.org_projects where id = p_id;
    return found and private.project_visible(p);
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
  f public.org_financings;
  p public.org_projects;
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
  elsif p_type = 'financing' then
    select * into f from public.org_financings where id = p_id;
    return found and f.status not in ('rejected', 'withdrawn', 'closed')
      and (f.user_id = private.active_uid() or private.has_org_role(f.organization_id,
           array['org_admin', 'projects_manager', 'finance_admin']::public.org_role[]));
  elsif p_type = 'project' then
    select * into p from public.org_projects where id = p_id;
    return found and p.status <> 'closed' and private.project_editable(p);
  end if;
  return false;
end;
$$;

revoke all on function
  public.org_financing_submit(text, uuid, text, text, text, integer, text, integer, text, text),
  public.org_financing_member_action(uuid, text, text),
  public.org_financing_check(uuid, boolean, text),
  public.org_financing_evaluate(uuid, jsonb, text, text),
  public.org_financing_decide(uuid, boolean, integer, text, public.org_account, uuid, boolean,
    integer, date, text),
  public.org_financing_disburse(uuid, integer, public.org_payment_method, text, text),
  public.org_financing_repay(uuid, integer, public.org_payment_method, text),
  public.org_financing_close(uuid, text),
  public.org_financings_page(text, public.org_financing_status, text, integer),
  public.my_financings(text),
  public.org_financing_view(uuid),
  public.org_project_save(text, uuid, uuid, text, text, text, integer, text, date, date, text,
    text, text, text),
  public.org_project_update(uuid, public.org_project_status, integer, text),
  public.org_projects_list(text, public.org_project_status, uuid),
  public.org_project_view(uuid)
  from public, anon;
grant execute on function
  public.org_financing_submit(text, uuid, text, text, text, integer, text, integer, text, text),
  public.org_financing_member_action(uuid, text, text),
  public.org_financing_check(uuid, boolean, text),
  public.org_financing_evaluate(uuid, jsonb, text, text),
  public.org_financing_decide(uuid, boolean, integer, text, public.org_account, uuid, boolean,
    integer, date, text),
  public.org_financing_disburse(uuid, integer, public.org_payment_method, text, text),
  public.org_financing_repay(uuid, integer, public.org_payment_method, text),
  public.org_financing_close(uuid, text),
  public.org_financings_page(text, public.org_financing_status, text, integer),
  public.my_financings(text),
  public.org_financing_view(uuid),
  public.org_project_save(text, uuid, uuid, text, text, text, integer, text, date, date, text,
    text, text, text),
  public.org_project_update(uuid, public.org_project_status, integer, text),
  public.org_projects_list(text, public.org_project_status, uuid),
  public.org_project_view(uuid)
  to authenticated;
