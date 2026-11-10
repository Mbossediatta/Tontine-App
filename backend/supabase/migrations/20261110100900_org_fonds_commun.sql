-- Fonds commun AFP, répartition des recettes et comptabilité des caisses
-- (cahier § 2.4, § 3.1 à § 3.5, § 4.3, § 16 et § 17).
--
-- Comptabilité en partie double, en FCFA entiers (aucun nombre flottant) :
-- - trois sortes de comptes : la trésorerie (l'argent réellement détenu sur les comptes
--   institutionnels de l'AFP), la caisse analytique de chaque structure, le fonds commun ;
-- - chaque opération (org_entries) a des lignes équilibrées au débit et au crédit
--   (org_entry_lines). Solde d'une caisse = crédits − débits. La trésorerie est donc
--   toujours égale à la somme des caisses : les caisses ne sont qu'une ventilation ;
-- - un paiement de militant crédite la caisse de sa structure (recette), puis la règle de
--   répartition en vigueur ce jour-là verse une part au fonds commun (transfert entre
--   caisses : jamais compté comme une nouvelle recette consolidée) ;
-- - le taux appliqué est écrit sur l'opération : une nouvelle règle ne recalcule rien ;
-- - une opération n'est jamais supprimée ni modifiée : une erreur se corrige par une
--   contre-passation (annulation), avec motif, auteur et date.
--
-- Fonds commun alimenté par : part des frais d'adhésion et des cotisations (pourcentage),
-- contributions fixes des structures, contributions volontaires, dons.

-- ---------------------------------------------------------------------------
-- Paramètres généraux de l'organisation (cahier § 4.3)
-- ---------------------------------------------------------------------------

alter table public.organizations
  add column settings jsonb not null default '{}'::jsonb,
  add column next_entry_number integer not null default 1 check (next_entry_number >= 1);

-- Paramètres en vigueur : valeurs par défaut complétées par celles choisies par l'AFP.
create or replace function private.org_settings(p_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    -- Rappels de cotisation : J-5, J-2, jour J, J+3, J+7, J+15 (cahier § 9.2).
    'reminderOffsets', '[-5, -2, 0, 3, 7, 15]'::jsonb,
    -- Au-delà de ce montant, seule l'administration générale approuve une dépense.
    'expenseCeiling', 500000,
    -- Le service financier vérifie la disponibilité avant la décision.
    'expenseNeedsVerification', true,
    'financingMaxAmount', 2000000,
    'financingMaxMonths', 24,
    'receiptFooter', 'Merci pour votre engagement au service de l’AFP.',
    'membershipNote', ''
  ) || coalesce((select o.settings from public.organizations o where o.id = p_org), '{}'::jsonb)
$$;

-- ---------------------------------------------------------------------------
-- Droits
-- ---------------------------------------------------------------------------

-- Consultation de toutes les finances : rôles centraux et super admin (lecture seule).
create or replace function private.sees_org_finance(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_super_admin() or private.has_org_role(p_org,
    array['org_admin', 'finance_admin', 'controller', 'validator', 'projects_manager']
      ::public.org_role[])
$$;

create or replace function private.require_org_roles(
  p_org uuid, p_roles public.org_role[], p_message text
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
begin
  if not private.has_org_role(p_org, p_roles) then
    raise exception '%', p_message using errcode = '42501', hint = 'access_denied:org_finance';
  end if;
  return uid;
end;
$$;

create or replace function private.require_sees_finance(p_org uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
begin
  if not private.sees_org_finance(p_org) then
    raise exception 'Réservé à l’administration centrale de l’AFP.'
      using errcode = '42501', hint = 'access_denied:org_finance';
  end if;
  return uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Règles de répartition et contributions fixes (cahier § 3.2 et § 3.3)
-- ---------------------------------------------------------------------------

create type public.org_rule_kind as enum ('percent', 'fixed');

-- Une règle n'est jamais modifiée : une nouvelle règle (date de prise d'effet plus
-- récente) la remplace ; l'ensemble forme l'historique des modifications.
create table public.org_allocation_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Structure concernée ; vide : toutes les structures.
  structure_id uuid references public.org_structures (id) on delete cascade,
  kind public.org_rule_kind not null,
  -- percent : nature des recettes concernées et part du fonds commun en points de base
  -- (1 % = 100 ; 0 = plus de reversement).
  fund_kind public.org_fund_kind,
  rate_bp integer check (rate_bp between 0 and 10000),
  -- fixed : montant forfaitaire par période (0 = contribution arrêtée).
  amount integer check (amount between 0 and 100000000),
  frequency public.org_fund_frequency,
  effective_from date not null,
  -- Autorité ayant validé la règle (ex. « Bureau politique du 12/11/2026 »).
  authority text not null check (char_length(btrim(authority)) between 3 and 120),
  note text check (char_length(note) <= 300),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint org_rules_percent check (
    kind <> 'percent' or (fund_kind is not null and rate_bp is not null
                          and amount is null and frequency is null)),
  constraint org_rules_fixed check (
    kind <> 'fixed' or (amount is not null and frequency in ('monthly', 'quarterly', 'yearly')
                        and fund_kind is null and rate_bp is null))
);

create index org_rules_org_idx on public.org_allocation_rules (organization_id, kind, effective_from);

create trigger org_allocation_rules_append_only
  before update or delete on public.org_allocation_rules
  for each row when (pg_trigger_depth() = 0)
  execute function private.forbid_change();

-- ---------------------------------------------------------------------------
-- Opérations comptables
-- ---------------------------------------------------------------------------

create type public.org_account as enum ('treasury', 'structure', 'common');
create type public.org_entry_nature as enum (
  'recette',                 -- paiement d'un militant (caisse de sa structure)
  'part_fonds_commun',       -- répartition automatique vers le fonds commun
  'contribution_fixe',       -- contribution forfaitaire d'une structure
  'contribution_volontaire', -- versement volontaire d'un membre ou d'une structure
  'don',                     -- don ou autre ressource autorisée
  'depense',                 -- dépense payée
  'decaissement',            -- financement décaissé
  'remboursement',           -- remboursement d'un prêt
  'annulation'               -- contre-passation d'une opération
);
create type public.org_source_kind as enum ('membre', 'structure', 'externe');

create table public.org_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Identifiant de l'opération : « AFP-OP2026-000123 ».
  entry_number text not null unique,
  nature public.org_entry_nature not null,
  amount integer not null check (amount > 0),
  label text not null check (char_length(label) between 3 and 200),
  -- Structure concernée.
  structure_id uuid references public.org_structures (id) on delete restrict,
  payment_id uuid references public.org_payments (id) on delete restrict,
  rule_id uuid references public.org_allocation_rules (id) on delete restrict,
  -- Taux appliqué (répartition), figé au moment de l'opération.
  rate_bp integer,
  -- Contribution fixe : période réglée (premier jour du mois).
  period date,
  source_kind public.org_source_kind,
  source_user uuid references public.profiles (id) on delete set null,
  -- Origine lisible (donateur, membre, structure).
  origin text check (char_length(origin) <= 120),
  method public.org_payment_method,
  reference text check (char_length(reference) <= 80),
  note text check (char_length(note) <= 300),
  -- Auteur de l'opération et responsable de validation.
  created_by uuid references public.profiles (id) on delete set null,
  validated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Contre-passation : l'opération annulée.
  reversal_of uuid references public.org_entries (id) on delete restrict,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id) on delete set null,
  cancel_reason text check (char_length(cancel_reason) <= 200)
);

create index org_entries_org_idx on public.org_entries (organization_id, created_at desc);
create index org_entries_structure_idx on public.org_entries (structure_id, created_at desc);
create index org_entries_payment_idx on public.org_entries (payment_id);
create unique index org_entries_reversal_key on public.org_entries (reversal_of);

create table public.org_entry_lines (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.org_entries (id) on delete restrict,
  account public.org_account not null,
  structure_id uuid references public.org_structures (id) on delete restrict,
  debit integer not null default 0 check (debit >= 0),
  credit integer not null default 0 check (credit >= 0),
  constraint org_entry_lines_one_side check ((debit > 0) <> (credit > 0)),
  constraint org_entry_lines_structure check ((account = 'structure') = (structure_id is not null))
);

create index org_entry_lines_entry_idx on public.org_entry_lines (entry_id);
create index org_entry_lines_account_idx on public.org_entry_lines (account, structure_id);

-- Lignes : ajout seul.
create trigger org_entry_lines_append_only
  before update or delete on public.org_entry_lines
  for each row execute function private.forbid_change();

-- Opérations : seule l'annulation peut être notée, rien d'autre ne change.
create or replace function private.org_entry_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Une opération financière n’est jamais supprimée.'
      using errcode = 'insufficient_privilege';
  end if;
  if (to_jsonb(new) - array['cancelled_at', 'cancelled_by', 'cancel_reason'])
     <> (to_jsonb(old) - array['cancelled_at', 'cancelled_by', 'cancel_reason'])
     or old.cancelled_at is not null then
    raise exception 'Une opération financière validée ne se modifie pas : annulez-la.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger org_entries_guard
  before update or delete on public.org_entries
  for each row execute function private.org_entry_guard();

-- Équilibre débit = crédit, vérifié à la fin de la transaction.
create or replace function private.org_entry_balanced()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select coalesce(sum(l.debit - l.credit), 0) from public.org_entry_lines l
      where l.entry_id = new.entry_id) <> 0 then
    raise exception 'Opération déséquilibrée (débit ≠ crédit).' using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger org_entry_lines_balanced
  after insert on public.org_entry_lines
  deferrable initially deferred
  for each row execute function private.org_entry_balanced();

alter table public.org_allocation_rules enable row level security;
alter table public.org_entries enable row level security;
alter table public.org_entry_lines enable row level security;
revoke all on public.org_allocation_rules, public.org_entries, public.org_entry_lines
  from anon, authenticated;

create or replace function private.next_entry_number(p_org uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.organizations;
begin
  update public.organizations set next_entry_number = next_entry_number + 1
  where id = p_org returning * into o;
  return o.short_name || '-OP' || to_char(current_date, 'YYYY') || '-'
    || lpad((o.next_entry_number - 1)::text, 6, '0');
end;
$$;

-- Crée l'en-tête d'une opération (champs facultatifs dans p_fields) et renvoie son id.
create or replace function private.entry_create(
  p_org uuid,
  p_nature public.org_entry_nature,
  p_amount integer,
  p_label text,
  p_fields jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.org_entries
  select * from jsonb_populate_record(null::public.org_entries,
    jsonb_build_object('created_by', private.active_uid())
    || coalesce(p_fields, '{}'::jsonb)
    || jsonb_build_object(
      'id', v_id, 'organization_id', p_org, 'entry_number', private.next_entry_number(p_org),
      'nature', p_nature, 'amount', p_amount, 'label', left(p_label, 200),
      'created_at', now(), 'reversal_of', p_fields -> 'reversal_of'));
  return v_id;
end;
$$;

-- Mouvement de p_amount : débit du compte « from », crédit du compte « to ».
-- Recette : trésorerie → caisse ; transfert : caisse → fonds commun ;
-- dépense : caisse → trésorerie.
create or replace function private.entry_move(
  p_entry uuid,
  p_from public.org_account, p_from_structure uuid,
  p_to public.org_account, p_to_structure uuid,
  p_amount integer
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.org_entry_lines (entry_id, account, structure_id, debit, credit)
  values (p_entry, p_from, p_from_structure, p_amount, 0),
         (p_entry, p_to, p_to_structure, 0, p_amount);
$$;

-- Solde analytique d'un compte (crédits − débits ; la trésorerie est en négatif).
create or replace function private.account_balance(
  p_org uuid, p_account public.org_account, p_structure uuid default null
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(l.credit - l.debit), 0)
  from public.org_entry_lines l
  join public.org_entries e on e.id = l.entry_id
  where e.organization_id = p_org and l.account = p_account
    and l.structure_id is not distinct from p_structure
$$;

-- Contre-passation : nouvelle opération aux lignes inversées, l'originale est marquée.
create or replace function private.entry_reverse(p_entry uuid, p_actor uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.org_entries;
  v_rev uuid;
begin
  select * into e from public.org_entries where id = p_entry for update;
  if e.cancelled_at is not null or e.nature = 'annulation' then
    return null;
  end if;
  v_rev := private.entry_create(e.organization_id, 'annulation', e.amount,
    'Annulation de ' || e.entry_number || ' : ' || e.label,
    jsonb_build_object('structure_id', e.structure_id, 'payment_id', e.payment_id,
      'reversal_of', e.id, 'created_by', p_actor, 'note', left(p_reason, 300)));
  insert into public.org_entry_lines (entry_id, account, structure_id, debit, credit)
  select v_rev, l.account, l.structure_id, l.credit, l.debit
  from public.org_entry_lines l where l.entry_id = e.id;
  update public.org_entries
  set cancelled_at = now(), cancelled_by = p_actor, cancel_reason = left(p_reason, 200)
  where id = e.id;
  return v_rev;
end;
$$;

-- ---------------------------------------------------------------------------
-- Comptabilisation automatique des paiements de militants
-- ---------------------------------------------------------------------------

-- Règle de pourcentage en vigueur à une date : celle de la structure, sinon la règle
-- générale ; la plus récente l'emporte.
create or replace function private.allocation_rule(
  p_structure uuid, p_kind public.org_fund_kind, p_at date
)
returns public.org_allocation_rules
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.org_allocation_rules;
begin
  select x.* into r
  from public.org_allocation_rules x
  join public.org_structures s on s.id = p_structure
  where x.organization_id = s.organization_id and x.kind = 'percent' and x.fund_kind = p_kind
    and x.effective_from <= p_at and (x.structure_id = p_structure or x.structure_id is null)
  order by (x.structure_id is null), x.effective_from desc, x.created_at desc
  limit 1;
  return r;
end;
$$;

create or replace function private.ledger_post_payment(p_payment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pay public.org_payments;
  f public.org_funds;
  s public.org_structures;
  r public.org_allocation_rules;
  v_entry uuid;
  v_share integer;
begin
  select * into pay from public.org_payments where id = p_payment;
  f := private.require_fund(pay.fund_id);
  s := private.require_structure(f.structure_id);

  v_entry := private.entry_create(s.organization_id, 'recette', pay.amount,
    format('Paiement %s – %s', pay.receipt_number, f.name),
    jsonb_build_object('structure_id', s.id, 'payment_id', pay.id, 'source_kind', 'membre',
      'source_user', pay.user_id, 'origin', private.full_name(pay.user_id),
      'method', pay.method, 'reference', pay.reference, 'created_by', pay.recorded_by));
  perform private.entry_move(v_entry, 'treasury', null, 'structure', s.id, pay.amount);

  r := private.allocation_rule(s.id, f.kind, (pay.created_at at time zone 'Africa/Dakar')::date);
  v_share := case when r.id is null then 0 else (pay.amount::bigint * r.rate_bp / 10000)::integer end;
  if v_share > 0 then
    v_entry := private.entry_create(s.organization_id, 'part_fonds_commun', v_share,
      format('Part du fonds commun (%s %%) – paiement %s', trim(to_char(r.rate_bp / 100.0,
        'FM990D99'), '.,'), pay.receipt_number),
      jsonb_build_object('structure_id', s.id, 'payment_id', pay.id, 'rule_id', r.id,
        'rate_bp', r.rate_bp, 'source_kind', 'structure', 'origin', s.name,
        'created_by', pay.recorded_by));
    perform private.entry_move(v_entry, 'structure', s.id, 'common', null, v_share);
  end if;
end;
$$;

create or replace function private.ledger_on_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  e record;
begin
  if tg_op = 'INSERT' then
    perform private.ledger_post_payment(new.id);
  elsif old.cancelled_at is null and new.cancelled_at is not null then
    for e in
      select x.id from public.org_entries x
      where x.payment_id = new.id and x.nature <> 'annulation' and x.cancelled_at is null
      order by x.created_at desc, x.entry_number desc
    loop
      perform private.entry_reverse(e.id, new.cancelled_by,
        coalesce(new.cancel_reason, 'Paiement annulé'));
    end loop;
  end if;
  return null;
end;
$$;

create trigger org_payments_ledger
  after insert or update of cancelled_at on public.org_payments
  for each row execute function private.ledger_on_payment();

-- Paiements déjà enregistrés : comptabilisés sans répartition (règles inexistantes alors).
do $$
declare
  p record;
  v_entry uuid;
  s public.org_structures;
begin
  for p in
    select x.*, f.structure_id, f.name as fund_name from public.org_payments x
    join public.org_funds f on f.id = x.fund_id
    order by x.created_at
  loop
    select * into s from public.org_structures where id = p.structure_id;
    v_entry := private.entry_create(s.organization_id, 'recette', p.amount,
      format('Paiement %s – %s', p.receipt_number, p.fund_name),
      jsonb_build_object('structure_id', s.id, 'payment_id', p.id, 'source_kind', 'membre',
        'source_user', p.user_id, 'method', p.method, 'reference', p.reference,
        'created_by', p.recorded_by));
    perform private.entry_move(v_entry, 'treasury', null, 'structure', s.id, p.amount);
    if p.cancelled_at is not null then
      perform private.entry_reverse(v_entry, p.cancelled_by, coalesce(p.cancel_reason, 'Annulé'));
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Justificatifs (stockage privé « afp-documents »)
-- ---------------------------------------------------------------------------

create table public.org_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Chemin dans le stockage : « <compte>/<identifiant>-<nom> ».
  path text not null unique check (char_length(path) <= 300),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  mime text not null check (mime in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size integer not null check (size between 1 and 10485760),
  category text not null default 'justificatif' check (category in
    ('justificatif', 'facture', 'recu', 'contrat', 'rapport', 'pv', 'photo', 'autre')),
  entity_type text not null check (entity_type in ('entry', 'expense', 'financing', 'project')),
  entity_id uuid not null,
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index org_documents_entity_idx on public.org_documents (entity_type, entity_id);

alter table public.org_documents enable row level security;
revoke all on public.org_documents from anon, authenticated;

create trigger org_documents_append_only
  before update or delete on public.org_documents
  for each row execute function private.forbid_change();

-- Organisation d'une pièce rattachée (null : objet inconnu). Complétée par les migrations
-- des dépenses, financements et projets.
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
  end if;
  return null;
end;
$$;

-- Qui voit une pièce : complété par les migrations suivantes.
create or replace function private.entity_visible(p_type text, p_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e public.org_entries;
begin
  if p_type = 'entry' then
    select * into e from public.org_entries where id = p_id;
    return found and (private.sees_org_finance(e.organization_id)
      or (e.structure_id is not null and private.views_structure_money(e.structure_id)));
  end if;
  return false;
end;
$$;

-- Qui joint une pièce : complété par les migrations suivantes.
create or replace function private.entity_attachable(p_type text, p_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e public.org_entries;
begin
  if p_type = 'entry' then
    select * into e from public.org_entries where id = p_id;
    return found and (private.has_org_role(e.organization_id,
        array['org_admin', 'finance_admin']::public.org_role[])
      or (e.structure_id is not null and private.handles_structure_money(e.structure_id)));
  end if;
  return false;
end;
$$;

create or replace function private.document_path_visible(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.org_documents d
    where d.path = p_path and private.entity_visible(d.entity_type, d.entity_id)
  )
$$;

grant execute on function private.document_path_visible(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('afp-documents', 'afp-documents', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy afp_documents_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'afp-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy afp_documents_select on storage.objects
  for select to authenticated
  using (bucket_id = 'afp-documents' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or private.document_path_visible(name)));

create or replace function private.documents_json(p_type text, p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'path', d.path, 'name', d.name, 'mime', d.mime, 'size', d.size,
    'category', d.category, 'createdAt', d.created_at,
    'uploadedBy', private.full_name(d.uploaded_by)) order by d.created_at), '[]'::jsonb)
  from public.org_documents d where d.entity_type = p_type and d.entity_id = p_id
$$;

-- Rattache un fichier déjà déposé dans le stockage (dossier du compte connecté).
create or replace function public.org_document_attach(
  p_entity_type text,
  p_entity_id uuid,
  p_path text,
  p_name text,
  p_mime text,
  p_size integer,
  p_category text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  v_org uuid := private.entity_org(p_entity_type, p_entity_id);
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_id uuid;
begin
  if v_org is null then
    raise exception 'Élément introuvable.' using errcode = 'P0002';
  end if;
  if not private.entity_attachable(p_entity_type, p_entity_id) then
    raise exception 'Vous ne pouvez pas joindre de pièce à cet élément.'
      using errcode = '42501', hint = 'access_denied:document';
  end if;
  if p_path is null or split_part(p_path, '/', 1) <> uid::text then
    raise exception 'Fichier invalide.' using errcode = '22023';
  end if;
  perform private.inspect_input('name', v_name);
  if not exists (
    select 1 from storage.objects o where o.bucket_id = 'afp-documents' and o.name = p_path
  ) then
    raise exception 'Le fichier n’a pas été reçu. Réessayez.' using errcode = '22023';
  end if;
  insert into public.org_documents (organization_id, path, name, mime, size, category,
    entity_type, entity_id, uploaded_by)
  values (v_org, p_path, coalesce(v_name, 'Pièce jointe'), p_mime, p_size,
    coalesce(nullif(p_category, ''), 'justificatif'), p_entity_type, p_entity_id, uid)
  returning id into v_id;
  perform private.audit(uid, 'org_document_added',
    format('a joint la pièce « %s »', coalesce(v_name, 'Pièce jointe')));
  return v_id;
end;
$$;

create or replace function public.org_documents_list(p_entity_type text, p_entity_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_uid();
  if not private.entity_visible(p_entity_type, p_entity_id) then
    raise exception 'Accès refusé.' using errcode = '42501', hint = 'access_denied:document';
  end if;
  return private.documents_json(p_entity_type, p_entity_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Règles : ajout et contributions fixes dues
-- ---------------------------------------------------------------------------

create or replace function public.org_allocation_rule_add(
  p_slug text,
  p_kind public.org_rule_kind,
  p_structure uuid,
  p_fund_kind public.org_fund_kind,
  p_rate_bp integer,
  p_amount integer,
  p_frequency public.org_fund_frequency,
  p_effective_from date,
  p_authority text,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.organizations := private.require_org_by_slug(p_slug);
  uid uuid := private.require_org_roles(o.id, array['org_admin', 'finance_admin']::public.org_role[],
    'Seule l’administration générale ou financière fixe les règles de répartition.');
  v_authority text := nullif(btrim(coalesce(p_authority, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id uuid;
  v_label text;
begin
  perform private.inspect_input('authority', v_authority);
  perform private.inspect_input('note', v_note);
  if v_authority is null or char_length(v_authority) not between 3 and 120 then
    raise exception 'Indiquez l’autorité qui a validé la règle.' using errcode = '22023';
  end if;
  if p_effective_from is null or p_effective_from < current_date then
    raise exception 'La date de prise d’effet doit être aujourd’hui ou plus tard (les opérations passées ne sont pas recalculées).'
      using errcode = '22023';
  end if;
  if p_structure is not null and not exists (
    select 1 from public.org_structures s where s.id = p_structure and s.organization_id = o.id
  ) then
    raise exception 'Structure introuvable.' using errcode = 'P0002';
  end if;
  if p_kind = 'percent' then
    if p_fund_kind is null or p_rate_bp is null or p_rate_bp not between 0 and 10000 then
      raise exception 'Indiquez la nature des recettes et un pourcentage entre 0 et 100.'
        using errcode = '22023';
    end if;
  elsif p_amount is null or p_amount not between 0 and 100000000
        or p_frequency not in ('monthly', 'quarterly', 'yearly') then
    raise exception 'Indiquez le montant et la périodicité de la contribution fixe.'
      using errcode = '22023';
  end if;

  insert into public.org_allocation_rules (organization_id, structure_id, kind, fund_kind,
    rate_bp, amount, frequency, effective_from, authority, note, created_by)
  values (o.id, p_structure, p_kind,
    case when p_kind = 'percent' then p_fund_kind end,
    case when p_kind = 'percent' then p_rate_bp end,
    case when p_kind = 'fixed' then p_amount end,
    case when p_kind = 'fixed' then p_frequency end,
    p_effective_from, v_authority, v_note, uid)
  returning id into v_id;

  v_label := case when p_kind = 'percent'
    then format('%s %% des recettes « %s »', p_rate_bp / 100.0, p_fund_kind)
    else format('contribution fixe de %s', private.format_amount(p_amount)) end;
  perform private.audit(uid, 'org_rule_added',
    format('a fixé une règle du fonds commun : %s, à partir du %s (%s)', v_label,
      to_char(p_effective_from, 'DD/MM/YYYY'),
      coalesce((select s.name from public.org_structures s where s.id = p_structure),
               'toutes les structures')));
  return v_id;
end;
$$;

-- Contributions fixes dues par une structure pour une année : une ligne par période
-- échue (jusqu'au mois en cours), avec le montant de la règle alors en vigueur.
create or replace function private.fixed_dues(p_structure uuid, p_year integer)
returns table (period date, amount integer, rule_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.org_structures := private.require_structure(p_structure);
  m date;
  r public.org_allocation_rules;
  last_month date := least(make_date(p_year, 12, 1), date_trunc('month', current_date)::date);
begin
  m := make_date(p_year, 1, 1);
  while m <= last_month loop
    select x.* into r from public.org_allocation_rules x
    where x.organization_id = s.organization_id and x.kind = 'fixed'
      and x.effective_from < (m + interval '1 month')::date
      and (x.structure_id = s.id or x.structure_id is null)
    order by (x.structure_id is null), x.effective_from desc, x.created_at desc
    limit 1;
    if r.id is not null and r.amount > 0 and (
      r.frequency = 'monthly'
      or (r.frequency = 'quarterly' and ((extract(month from m)::int - 1) % 3 = 0
          or date_trunc('month', r.effective_from) = m))
      or (r.frequency = 'yearly' and (extract(month from m)::int = 1
          or date_trunc('month', r.effective_from) = m))
    ) then
      period := m;
      amount := r.amount;
      rule_id := r.id;
      return next;
    end if;
    m := (m + interval '1 month')::date;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Versements au fonds commun
-- ---------------------------------------------------------------------------

create or replace function private.check_reference(
  p_org uuid, p_method public.org_payment_method, p_reference text
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if char_length(coalesce(p_reference, '')) > 80 then
    raise exception 'Référence trop longue (80 caractères au plus).' using errcode = '22023';
  end if;
  if p_method in ('wave', 'orange_money', 'virement') and p_reference is null then
    raise exception 'Indiquez la référence de la transaction.' using errcode = '22023';
  end if;
  if p_reference is not null and exists (
    select 1 from public.org_entries e
    where e.organization_id = p_org and e.method = p_method and e.reference = p_reference
      and e.cancelled_at is null and e.nature <> 'annulation'
  ) then
    raise exception 'Cette référence de transaction a déjà été enregistrée.' using errcode = '23505';
  end if;
end;
$$;

-- Contribution volontaire ou don au fonds commun. Source : un membre, une structure
-- (prélevé sur sa caisse : transfert) ou un donateur extérieur.
create or replace function public.org_common_receive(
  p_slug text,
  p_nature public.org_entry_nature,
  p_source_kind public.org_source_kind,
  p_user uuid,
  p_structure uuid,
  p_origin text,
  p_amount integer,
  p_method public.org_payment_method,
  p_reference text,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.organizations := private.require_org_by_slug(p_slug);
  uid uuid := private.require_org_roles(o.id, array['org_admin', 'finance_admin']::public.org_role[],
    'Seule l’administration générale ou financière enregistre les versements au fonds commun.');
  v_origin text := nullif(btrim(coalesce(p_origin, '')), '');
  v_reference text := nullif(btrim(coalesce(p_reference, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  s public.org_structures;
  v_entry uuid;
begin
  perform private.inspect_input('origin', v_origin);
  perform private.inspect_input('reference', v_reference);
  perform private.inspect_input('note', v_note);
  if p_nature not in ('contribution_volontaire', 'don') then
    raise exception 'Nature de versement invalide.' using errcode = '22023';
  end if;
  if coalesce(p_amount, 0) <= 0 or p_amount > 100000000 then
    raise exception 'Montant invalide.' using errcode = '22023';
  end if;

  if p_source_kind = 'structure' then
    select * into s from public.org_structures where id = p_structure and organization_id = o.id;
    if not found then
      raise exception 'Structure introuvable.' using errcode = 'P0002';
    end if;
    if private.account_balance(o.id, 'structure', s.id) < p_amount then
      raise exception 'Solde insuffisant dans la caisse de « % » (%).', s.name,
        private.format_amount(private.account_balance(o.id, 'structure', s.id)::integer)
        using errcode = '22023';
    end if;
    v_entry := private.entry_create(o.id, p_nature, p_amount,
      format('Versement volontaire de « %s » au fonds commun', s.name),
      jsonb_build_object('structure_id', s.id, 'source_kind', 'structure', 'origin', s.name,
        'note', v_note, 'validated_by', uid));
    perform private.entry_move(v_entry, 'structure', s.id, 'common', null, p_amount);
  else
    if p_source_kind = 'membre' then
      if not exists (select 1 from public.organization_members m
                     where m.organization_id = o.id and m.user_id = p_user) then
        raise exception 'Ce membre est introuvable.' using errcode = 'P0002';
      end if;
      v_origin := private.full_name(p_user);
    elsif v_origin is null or char_length(v_origin) < 2 then
      raise exception 'Indiquez l’origine du versement (donateur).' using errcode = '22023';
    end if;
    if p_method is null then
      raise exception 'Indiquez le mode de paiement.' using errcode = '22023';
    end if;
    perform private.check_reference(o.id, p_method, v_reference);
    v_entry := private.entry_create(o.id, p_nature, p_amount,
      format('%s au fonds commun – %s',
        case when p_nature = 'don' then 'Don' else 'Contribution volontaire' end, v_origin),
      jsonb_build_object('source_kind', p_source_kind, 'source_user',
        case when p_source_kind = 'membre' then p_user end, 'origin', v_origin,
        'method', p_method, 'reference', v_reference, 'note', v_note, 'validated_by', uid));
    perform private.entry_move(v_entry, 'treasury', null, 'common', null, p_amount);
    if p_source_kind = 'membre' then
      perform private.notify(p_user, 'organization', o.short_name || ' – Fonds commun',
        format('Merci : votre contribution de %s au fonds commun a été enregistrée.',
          private.format_amount(p_amount)), null);
    end if;
  end if;

  perform private.audit(uid, 'org_common_entry',
    format('a enregistré %s de %s au fonds commun (%s)',
      case when p_nature = 'don' then 'un don' else 'une contribution volontaire' end,
      private.format_amount(p_amount), coalesce(s.name, v_origin)));
  return v_entry;
end;
$$;

-- Contribution fixe d'une structure pour une période : transfert de sa caisse vers le
-- fonds commun. Par l'administration financière ou le responsable / trésorier.
create or replace function public.org_common_fixed_pay(
  p_structure uuid, p_period date, p_amount integer, p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.org_structures := private.require_structure(p_structure);
  o public.organizations := private.require_organization(s.organization_id);
  uid uuid := private.require_money_rights(s.id);
  v_period date := date_trunc('month', p_period)::date;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_due integer;
  v_rule uuid;
  v_entry uuid;
begin
  perform private.inspect_input('note', v_note);
  select d.amount, d.rule_id into v_due, v_rule
  from private.fixed_dues(s.id, extract(year from v_period)::int) d where d.period = v_period;
  if v_due is null then
    raise exception 'Aucune contribution fixe n’est due pour cette période.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.org_entries e
    where e.structure_id = s.id and e.nature = 'contribution_fixe' and e.period = v_period
      and e.cancelled_at is null
  ) then
    raise exception 'La contribution de cette période est déjà réglée.' using errcode = '23505';
  end if;
  if coalesce(p_amount, 0) <> v_due then
    raise exception 'Le montant dû pour cette période est %.', private.format_amount(v_due)
      using errcode = '22023';
  end if;
  if private.account_balance(o.id, 'structure', s.id) < v_due then
    raise exception 'Solde insuffisant dans la caisse de « % ».', s.name using errcode = '22023';
  end if;
  v_entry := private.entry_create(o.id, 'contribution_fixe', v_due,
    format('Contribution fixe de « %s » – %s', s.name, to_char(v_period, 'MM/YYYY')),
    jsonb_build_object('structure_id', s.id, 'rule_id', v_rule, 'period', v_period,
      'source_kind', 'structure', 'origin', s.name, 'note', v_note, 'validated_by', uid));
  perform private.entry_move(v_entry, 'structure', s.id, 'common', null, v_due);
  perform private.audit(uid, 'org_common_entry',
    format('a réglé la contribution fixe de « %s » (%s, %s)', s.name,
      to_char(v_period, 'MM/YYYY'), private.format_amount(v_due)));
  return v_entry;
end;
$$;

-- Annulation d'une opération saisie à la main (contributions, dons) : par une autre
-- personne que son auteur (séparation des fonctions, cahier § 17).
create or replace function public.org_entry_cancel(p_entry uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.org_entries;
  uid uuid := private.require_uid();
  reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into e from public.org_entries where id = p_entry;
  if not found then
    raise exception 'Opération introuvable.' using errcode = 'P0002';
  end if;
  perform private.require_org_roles(e.organization_id,
    array['org_admin', 'finance_admin']::public.org_role[],
    'Seule l’administration financière annule une opération.');
  if e.nature not in ('contribution_fixe', 'contribution_volontaire', 'don') then
    raise exception 'Cette opération s’annule depuis son paiement, sa dépense ou son financement.'
      using errcode = '22023';
  end if;
  if e.cancelled_at is not null then
    raise exception 'Cette opération est déjà annulée.' using errcode = '22023';
  end if;
  if e.created_by = uid then
    raise exception 'Une autre personne que l’auteur doit annuler cette opération.'
      using errcode = '42501', hint = 'access_denied:separation';
  end if;
  perform private.inspect_input('reason', reason);
  if reason is null or char_length(reason) > 200 then
    raise exception 'Indiquez le motif de l’annulation (200 caractères au plus).'
      using errcode = '22023';
  end if;
  perform private.entry_reverse(e.id, uid, reason);
  perform private.audit(uid, 'org_entry_cancelled',
    format('a annulé l’opération %s (%s) : %s', e.entry_number,
      private.format_amount(e.amount), reason));
end;
$$;

-- ---------------------------------------------------------------------------
-- Lectures
-- ---------------------------------------------------------------------------

create or replace function private.entry_json(e public.org_entries)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', e.id, 'number', e.entry_number, 'nature', e.nature, 'amount', e.amount,
    'label', e.label, 'structureId', e.structure_id,
    'structureName', (select s.name from public.org_structures s where s.id = e.structure_id),
    'origin', e.origin, 'method', e.method, 'reference', e.reference, 'note', e.note,
    'period', e.period, 'rateBp', e.rate_bp, 'createdAt', e.created_at,
    'author', private.full_name(e.created_by), 'authorId', e.created_by,
    'validator', private.full_name(e.validated_by),
    'cancelledAt', e.cancelled_at, 'cancelReason', e.cancel_reason,
    'cancelledBy', private.full_name(e.cancelled_by), 'reversalOf', e.reversal_of,
    -- Effet de l'opération sur chaque caisse (+ entrée, − sortie).
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object('account', l.account, 'structureId', l.structure_id,
        'amount', l.credit - l.debit))
      from public.org_entry_lines l where l.entry_id = e.id
    ), '[]'::jsonb),
    'documents', (select count(*) from public.org_documents d
                  where d.entity_type = 'entry' and d.entity_id = e.id)
  )
$$;

create or replace function private.rule_json(r public.org_allocation_rules)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id, 'kind', r.kind, 'structureId', r.structure_id,
    'structureName', (select s.name from public.org_structures s where s.id = r.structure_id),
    'fundKind', r.fund_kind, 'rateBp', r.rate_bp, 'amount', r.amount,
    'frequency', r.frequency, 'effectiveFrom', r.effective_from, 'authority', r.authority,
    'note', r.note, 'createdAt', r.created_at, 'author', private.full_name(r.created_by),
    -- En vigueur : la plus récente déjà applicable pour sa portée.
    'current', r.effective_from <= current_date and not exists (
      select 1 from public.org_allocation_rules x
      where x.organization_id = r.organization_id and x.kind = r.kind
        and x.structure_id is not distinct from r.structure_id
        and x.fund_kind is not distinct from r.fund_kind
        and x.effective_from <= current_date
        and (x.effective_from, x.created_at) > (r.effective_from, r.created_at)),
    'upcoming', r.effective_from > current_date
  )
$$;

-- Fonds commun : solde, entrées et sorties de l'année, contributions par structure,
-- règles (avec l'historique) et dernières opérations.
create or replace function public.org_common_view(p_slug text, p_year integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.organizations := private.require_org_by_slug(p_slug);
  uid uuid := private.require_sees_finance(o.id);
  v_year integer := coalesce(p_year, extract(year from current_date)::int);
begin
  return jsonb_build_object(
    'year', v_year,
    'canManage', private.has_org_role(o.id, array['org_admin', 'finance_admin']::public.org_role[]),
    'balance', private.account_balance(o.id, 'common'),
    'byNature', coalesce((
      select jsonb_object_agg(t.nature, t.total) from (
        select e.nature, sum(l.credit - l.debit) as total
        from public.org_entry_lines l join public.org_entries e on e.id = l.entry_id
        where e.organization_id = o.id and l.account = 'common'
          and e.nature <> 'annulation' and e.cancelled_at is null
          and extract(year from e.created_at) = v_year
        group by e.nature
      ) t
    ), '{}'::jsonb),
    'monthly', coalesce((
      select jsonb_agg(jsonb_build_object('month', to_char(gs.m, 'YYYY-MM'),
        'amount', coalesce((
          select sum(l.credit) from public.org_entry_lines l
          join public.org_entries e on e.id = l.entry_id
          where e.organization_id = o.id and l.account = 'common' and l.credit > 0
            and e.nature <> 'annulation' and e.cancelled_at is null
            and date_trunc('month', e.created_at) = gs.m), 0)) order by gs.m)
      from generate_series(make_date(v_year, 1, 1), make_date(v_year, 12, 1), interval '1 month') gs(m)
    ), '[]'::jsonb),
    'structures', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'status', s.status,
        'share', coalesce((select sum(e.amount) from public.org_entries e
          where e.structure_id = s.id and e.nature = 'part_fonds_commun' and e.cancelled_at is null
            and extract(year from e.created_at) = v_year), 0),
        'voluntary', coalesce((select sum(e.amount) from public.org_entries e
          where e.structure_id = s.id and e.nature = 'contribution_volontaire'
            and e.source_kind = 'structure' and e.cancelled_at is null
            and extract(year from e.created_at) = v_year), 0),
        'fixedDue', coalesce((select sum(d.amount) from private.fixed_dues(s.id, v_year) d), 0),
        'fixedPaid', coalesce((select sum(e.amount) from public.org_entries e
          where e.structure_id = s.id and e.nature = 'contribution_fixe' and e.cancelled_at is null
            and extract(year from e.period) = v_year), 0),
        'fixedPeriods', coalesce((select jsonb_agg(jsonb_build_object(
            'period', d.period, 'amount', d.amount,
            'paid', exists (select 1 from public.org_entries e where e.structure_id = s.id
              and e.nature = 'contribution_fixe' and e.period = d.period and e.cancelled_at is null))
            order by d.period)
          from private.fixed_dues(s.id, v_year) d), '[]'::jsonb),
        'balance', private.account_balance(o.id, 'structure', s.id)
      ) order by s.name)
      from public.org_structures s where s.organization_id = o.id and s.status <> 'archived'
    ), '[]'::jsonb),
    'rules', coalesce((
      select jsonb_agg(private.rule_json(r) order by r.kind, r.effective_from desc, r.created_at desc)
      from public.org_allocation_rules r where r.organization_id = o.id
    ), '[]'::jsonb),
    'entries', coalesce((
      select jsonb_agg(private.entry_json(e) order by e.created_at desc)
      from (
        select e.* from public.org_entries e
        where e.organization_id = o.id and exists (
          select 1 from public.org_entry_lines l where l.entry_id = e.id and l.account = 'common')
        order by e.created_at desc limit 15
      ) e
    ), '[]'::jsonb)
  );
end;
$$;

-- Journal des opérations (traçabilité, cahier § 3.5) : filtres, 50 par page.
create or replace function public.org_entries_page(
  p_slug text,
  p_account public.org_account,
  p_structure uuid,
  p_nature public.org_entry_nature,
  p_from date,
  p_to date,
  p_query text,
  p_offset integer
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
  central boolean := private.sees_org_finance(o.id);
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  visible uuid[];
begin
  select coalesce(array_agg(s.id), '{}') into visible
  from public.org_structures s
  where s.organization_id = o.id and private.views_structure_money(s.id);
  if not central and cardinality(visible) = 0 then
    raise exception 'Accès refusé.' using errcode = '42501', hint = 'access_denied:org_finance';
  end if;

  return (
    with filtered as (
      select e.* from public.org_entries e
      where e.organization_id = o.id
        and (central or e.structure_id = any (visible))
        and (p_structure is null or e.structure_id = p_structure)
        and (p_nature is null or e.nature = p_nature)
        and (p_account is null or exists (select 1 from public.org_entry_lines l
             where l.entry_id = e.id and l.account = p_account))
        and (p_from is null or e.created_at >= p_from)
        and (p_to is null or e.created_at < p_to + 1)
        and (v_query is null or e.entry_number ilike '%' || v_query || '%'
             or e.label ilike '%' || v_query || '%' or e.reference ilike '%' || v_query || '%'
             or e.origin ilike '%' || v_query || '%')
    )
    select jsonb_build_object(
      'rows', coalesce((
        select jsonb_agg(private.entry_json(x) order by x.created_at desc, x.entry_number desc)
        from (select * from filtered order by created_at desc, entry_number desc
              offset v_offset limit 50) x
      ), '[]'::jsonb),
      'total', (select count(*) from filtered),
      'pageSize', 50
    )
  );
end;
$$;

revoke all on function
  public.org_document_attach(text, uuid, text, text, text, integer, text),
  public.org_documents_list(text, uuid),
  public.org_allocation_rule_add(text, public.org_rule_kind, uuid, public.org_fund_kind, integer,
    integer, public.org_fund_frequency, date, text, text),
  public.org_common_receive(text, public.org_entry_nature, public.org_source_kind, uuid, uuid,
    text, integer, public.org_payment_method, text, text),
  public.org_common_fixed_pay(uuid, date, integer, text),
  public.org_entry_cancel(uuid, text),
  public.org_common_view(text, integer),
  public.org_entries_page(text, public.org_account, uuid, public.org_entry_nature, date, date,
    text, integer)
  from public, anon;
grant execute on function
  public.org_document_attach(text, uuid, text, text, text, integer, text),
  public.org_documents_list(text, uuid),
  public.org_allocation_rule_add(text, public.org_rule_kind, uuid, public.org_fund_kind, integer,
    integer, public.org_fund_frequency, date, text, text),
  public.org_common_receive(text, public.org_entry_nature, public.org_source_kind, uuid, uuid,
    text, integer, public.org_payment_method, text, text),
  public.org_common_fixed_pay(uuid, date, integer, text),
  public.org_entry_cancel(uuid, text),
  public.org_common_view(text, integer),
  public.org_entries_page(text, public.org_account, uuid, public.org_entry_nature, date, date,
    text, integer)
  to authenticated;
