-- Rapprochement bancaire (cahier AFP § 17 : « les soldes analytiques devront être
-- rapprochés des mouvements bancaires réels »).
-- L'organisation déclare ses comptes réels : banque, Wave, Orange Money, caisse en espèces
-- (d'une structure ou centrale). Pour chacun, le serveur calcule ce qu'il DEVRAIT contenir :
-- solde d'ouverture + entrées − sorties enregistrées avec ce moyen de paiement (opérations
-- du journal ; une annulation reprend le moyen de l'opération annulée). À chaque relevé,
-- le trésorier saisit le solde réel : l'écart est calculé et, s'il n'est pas nul, doit être
-- expliqué. Un rapprochement enregistré ne se modifie ni ne s'efface.

-- Nouvelle action paramétrable : tenir les comptes et saisir les relevés.
create or replace function private.org_permission_catalog()
returns table (key text, label text, description text, default_roles public.org_role[], rank integer)
language sql
immutable
set search_path = ''
as $$
  values
    ('common_fund', 'Gérer le fonds commun', 'Règles de répartition, versements reçus, annulation d’écritures.',
      array['org_admin', 'finance_admin']::public.org_role[], 1),
    ('expense_verify', 'Contrôler les dépenses', 'Vérifier une demande de dépense avant la décision.',
      array['finance_admin', 'controller']::public.org_role[], 2),
    ('expense_decide', 'Décider des dépenses', 'Approuver ou refuser une dépense.',
      array['validator', 'org_admin']::public.org_role[], 3),
    ('expense_pay', 'Payer les dépenses', 'Engager et payer une dépense approuvée sur la caisse centrale.',
      array['finance_admin']::public.org_role[], 4),
    ('financing_review', 'Instruire les financements', 'Vérifier le dossier et l’évaluer.',
      array['org_admin', 'projects_manager', 'finance_admin']::public.org_role[], 5),
    ('financing_decide', 'Décider des financements', 'Accorder ou refuser un financement.',
      array['validator', 'org_admin']::public.org_role[], 6),
    ('financing_disburse', 'Décaisser les financements', 'Verser l’argent d’un financement accordé.',
      array['finance_admin']::public.org_role[], 7),
    ('financing_repay', 'Enregistrer les remboursements', 'Remboursements des prêts.',
      array['finance_admin', 'org_admin']::public.org_role[], 8),
    ('financing_close', 'Clôturer les financements', 'Clore un dossier après son suivi.',
      array['org_admin', 'projects_manager']::public.org_role[], 9),
    ('projects', 'Gérer les projets', 'Créer et suivre les projets de toute l’organisation.',
      array['org_admin', 'projects_manager']::public.org_role[], 10),
    ('reconcile', 'Rapprocher les comptes', 'Déclarer les comptes réels et saisir les relevés (banque, Wave, Orange Money, espèces).',
      array['finance_admin', 'controller']::public.org_role[], 11)
$$;

alter type public.audit_action add value if not exists 'org_money_account_saved';
alter type public.audit_action add value if not exists 'org_reconciliation_recorded';

create table public.org_money_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  -- Moyen de paiement que ce compte reçoit (espèces, Wave, Orange Money, virement…).
  kind public.org_payment_method not null,
  -- Caisse d'une structure (espèces surtout) ; vide = compte central de l'organisation.
  structure_id uuid references public.org_structures (id) on delete restrict,
  -- Numéro de compte ou de marchand, masqué si besoin.
  reference text check (char_length(reference) <= 60),
  opening_date date not null,
  opening_balance bigint not null default 0,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index org_money_accounts_org_idx on public.org_money_accounts (organization_id);
alter table public.org_money_accounts enable row level security;

create table public.org_reconciliations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.org_money_accounts (id) on delete restrict,
  statement_date date not null,
  statement_balance bigint not null,
  expected_balance bigint not null,
  difference bigint generated always as (statement_balance - expected_balance) stored,
  note text check (char_length(note) <= 500),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index org_reconciliations_account_idx on public.org_reconciliations (account_id, statement_date desc);
alter table public.org_reconciliations enable row level security;

-- Un rapprochement enregistré ne change plus.
create trigger org_reconciliations_append_only
  before update or delete on public.org_reconciliations
  for each row execute function private.forbid_change();

-- Solde attendu d'un compte réel à une date (fin de journée).
create or replace function private.money_account_expected(p_account uuid, p_at date)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select a.opening_balance + coalesce((
    select sum(l.debit - l.credit)
    from public.org_entries e
    left join public.org_entries orig on orig.id = e.reversal_of
    join public.org_entry_lines l on l.entry_id = e.id and l.account = 'treasury'
    where e.organization_id = a.organization_id
      and coalesce(e.method, orig.method) = a.kind
      and (a.structure_id is null or coalesce(e.structure_id, orig.structure_id) = a.structure_id)
      and e.created_at >= (a.opening_date + 1)::timestamptz
      and e.created_at < (p_at + 1)::timestamptz
  ), 0)
  from public.org_money_accounts a where a.id = p_account
$$;

create or replace function private.money_account_json(a public.org_money_accounts)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', a.id, 'name', a.name, 'kind', a.kind, 'structureId', a.structure_id,
    'structureName', (select s.name from public.org_structures s where s.id = a.structure_id),
    'reference', a.reference, 'openingDate', a.opening_date, 'openingBalance', a.opening_balance,
    'isActive', a.is_active,
    'expected', private.money_account_expected(a.id, current_date),
    'reconciled', exists (select 1 from public.org_reconciliations r where r.account_id = a.id),
    'last', (
      select jsonb_build_object('date', r.statement_date, 'statement', r.statement_balance,
        'expected', r.expected_balance, 'difference', r.difference, 'note', r.note,
        'by', private.full_name(r.created_by), 'at', r.created_at)
      from public.org_reconciliations r where r.account_id = a.id
      order by r.statement_date desc, r.created_at desc limit 1))
$$;

-- Comptes réels et leur situation (consultation : rôles qui voient les finances).
create or replace function public.org_money_accounts(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.organizations := private.require_org_by_slug(p_slug);
begin
  perform private.require_sees_finance(o.id);
  return jsonb_build_object(
    'canManage', private.has_org_role(o.id, private.org_roles_for(o.id, 'reconcile')),
    'accounts', coalesce((
      select jsonb_agg(private.money_account_json(a) order by a.is_active desc, a.name)
      from public.org_money_accounts a where a.organization_id = o.id), '[]'::jsonb));
end;
$$;

create or replace function public.org_money_account_save(
  p_slug text, p_id uuid, p_name text, p_kind public.org_payment_method, p_structure uuid,
  p_reference text, p_opening_date date, p_opening_balance bigint, p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.organizations := private.require_org_by_slug(p_slug);
  uid uuid := private.require_org_roles(o.id, private.org_roles_for(o.id, 'reconcile'),
    'Seuls les rôles chargés du rapprochement déclarent les comptes.');
  a public.org_money_accounts;
  v_name text := btrim(coalesce(p_name, ''));
begin
  perform private.inspect_input('name', v_name);
  perform private.inspect_input('reference', p_reference);
  if char_length(v_name) not between 2 and 80 then
    raise exception 'Le nom du compte doit contenir entre 2 et 80 caractères.' using errcode = '22023';
  end if;
  if p_structure is not null and not exists (
    select 1 from public.org_structures s where s.id = p_structure and s.organization_id = o.id) then
    raise exception 'Structure introuvable.' using errcode = '22023';
  end if;
  if p_opening_date is null or p_opening_date > current_date then
    raise exception 'La date d’ouverture ne peut pas être dans le futur.' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.org_money_accounts (organization_id, name, kind, structure_id, reference,
      opening_date, opening_balance, is_active, created_by)
    values (o.id, v_name, p_kind, p_structure, nullif(btrim(coalesce(p_reference, '')), ''),
      p_opening_date, coalesce(p_opening_balance, 0), coalesce(p_active, true), uid)
    returning * into a;
  else
    select * into a from public.org_money_accounts where id = p_id and organization_id = o.id for update;
    if not found then
      raise exception 'Compte introuvable.' using errcode = 'P0002';
    end if;
    -- Après un premier rapprochement, l'ouverture et le moyen ne changent plus : les
    -- écarts déjà constatés resteraient faux.
    if exists (select 1 from public.org_reconciliations r where r.account_id = a.id) and (
      a.kind <> p_kind or a.structure_id is distinct from p_structure
      or a.opening_date <> p_opening_date or a.opening_balance <> coalesce(p_opening_balance, 0)) then
      raise exception 'Ce compte a déjà été rapproché : son moyen de paiement, sa structure et son ouverture ne changent plus.'
        using errcode = '22023';
    end if;
    update public.org_money_accounts
    set name = v_name, kind = p_kind, structure_id = p_structure,
        reference = nullif(btrim(coalesce(p_reference, '')), ''),
        opening_date = p_opening_date, opening_balance = coalesce(p_opening_balance, 0),
        is_active = coalesce(p_active, true)
    where id = a.id returning * into a;
  end if;
  perform private.audit(uid, 'org_money_account_saved',
    format('a enregistré le compte « %s » (%s)', a.name, o.name));
  return private.money_account_json(a);
end;
$$;

-- Saisie d'un relevé : l'écart non nul doit être expliqué.
create or replace function public.org_reconciliation_record(
  p_account uuid, p_statement_date date, p_statement_balance bigint, p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.org_money_accounts;
  uid uuid;
  v_expected bigint;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into a from public.org_money_accounts where id = p_account;
  if not found then
    raise exception 'Compte introuvable.' using errcode = 'P0002';
  end if;
  uid := private.require_org_roles(a.organization_id, private.org_roles_for(a.organization_id, 'reconcile'),
    'Seuls les rôles chargés du rapprochement saisissent les relevés.');
  perform private.inspect_input('note', v_note);
  if p_statement_date is null or p_statement_date > current_date or p_statement_date < a.opening_date then
    raise exception 'La date du relevé doit être entre l’ouverture du compte et aujourd’hui.'
      using errcode = '22023';
  end if;
  if p_statement_balance is null then
    raise exception 'Indiquez le solde du relevé.' using errcode = '22023';
  end if;
  v_expected := private.money_account_expected(a.id, p_statement_date);
  if p_statement_balance <> v_expected and v_note is null then
    raise exception 'Le relevé ne correspond pas au solde attendu (écart de % FCFA) : expliquez l’écart.',
      p_statement_balance - v_expected using errcode = '22023';
  end if;
  insert into public.org_reconciliations (account_id, statement_date, statement_balance,
    expected_balance, note, created_by)
  values (a.id, p_statement_date, p_statement_balance, v_expected, v_note, uid);
  perform private.audit(uid, 'org_reconciliation_recorded',
    format('a rapproché le compte « %s » au %s : relevé %s, attendu %s', a.name,
      to_char(p_statement_date, 'DD/MM/YYYY'), private.format_amount(p_statement_balance::int),
      private.format_amount(v_expected::int)));
  return private.money_account_json(a);
end;
$$;

-- Historique des rapprochements d'un compte.
create or replace function public.org_reconciliations(p_account uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.org_money_accounts;
begin
  select * into a from public.org_money_accounts where id = p_account;
  if not found then
    raise exception 'Compte introuvable.' using errcode = 'P0002';
  end if;
  perform private.require_sees_finance(a.organization_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'date', r.statement_date,
      'statement', r.statement_balance, 'expected', r.expected_balance,
      'difference', r.difference, 'note', r.note, 'by', private.full_name(r.created_by),
      'at', r.created_at) order by r.statement_date desc, r.created_at desc)
    from public.org_reconciliations r where r.account_id = a.id), '[]'::jsonb);
end;
$$;

revoke all on function public.org_money_accounts(text),
  public.org_money_account_save(text, uuid, text, public.org_payment_method, uuid, text, date, bigint, boolean),
  public.org_reconciliation_record(uuid, date, bigint, text),
  public.org_reconciliations(uuid) from public, anon;
grant execute on function public.org_money_accounts(text),
  public.org_money_account_save(text, uuid, text, public.org_payment_method, uuid, text, date, bigint, boolean),
  public.org_reconciliation_record(uuid, date, bigint, text),
  public.org_reconciliations(uuid) to authenticated;
revoke execute on all functions in schema private from public;
