-- Organisations institutionnelles (première : l'AFP), étape 1.
--
-- Une organisation est un espace fermé, à part des tontines grand public :
--   organisation (créée par le super admin)
--     └─ structures (commissions, mouvements, départements… créées par l'admin général)
--          └─ militants (inscrits par le lien d'invitation de leur structure, validés
--             par un responsable de la structure)
--
-- Cloisonnement :
-- - aucune lecture directe des nouvelles tables : tout passe par les fonctions
--   ci-dessous, qui vérifient elles-mêmes les droits ;
-- - le super admin crée l'organisation et nomme l'admin général ; il ne voit que les
--   chiffres globaux, jamais le fichier des militants ;
-- - l'admin général voit toute son organisation ; un responsable de structure voit sa
--   structure et les structures qui en dépendent (ex. un département et ses communes) ;
-- - un militant voit sa fiche et ses structures.
--
-- Les caisses, cotisations et le fonds commun viendront à l'étape 2.

alter type public.audit_action add value if not exists 'organization_saved';
alter type public.audit_action add value if not exists 'org_role_changed';
alter type public.audit_action add value if not exists 'structure_saved';
alter type public.audit_action add value if not exists 'structure_member_decided';

create type public.org_role as enum ('org_admin', 'finance_admin', 'controller');
create type public.structure_type as enum (
  'national', 'mouvement', 'commission_permanente', 'commission_ad_hoc',
  'departement', 'commune', 'diaspora', 'autre'
);
create type public.structure_status as enum ('active', 'suspended', 'archived');
create type public.structure_role as enum
  ('responsable', 'tresorier', 'secretaire', 'gestionnaire_membres');
create type public.org_member_status as enum ('pending', 'active', 'suspended', 'left');
create type public.structure_member_status as enum ('pending', 'active', 'left', 'rejected');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 3 and 80),
  -- Sigle : « AFP ». Préfixe des numéros de membre et des notifications.
  short_name text not null check (short_name ~ '^[A-Z0-9]{2,10}$'),
  -- Adresse de l'espace : /o/afp (entrée) et /espace/afp.
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,29}$'),
  color text not null default '#1A5BA8' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  logo_url text check (
    logo_url is null
    or (logo_url ~ '^data:image/(jpeg|png|webp);base64,' and octet_length(logo_url) <= 400000)
  ),
  is_suspended boolean not null default false,
  next_member_number integer not null default 1 check (next_member_number >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index organizations_short_name_key on public.organizations (short_name);

create trigger organizations_updated_at
  before update on public.organizations
  for each row execute function private.set_updated_at();

create table public.organization_roles (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.org_role not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id, role)
);

create index organization_roles_user_idx on public.organization_roles (user_id);

create table public.org_structures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Structure de rattachement (ex. une commune rattachée à son département).
  parent_id uuid references public.org_structures (id) on delete set null,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  structure_type public.structure_type not null,
  description text check (char_length(description) <= 300),
  contact_phone text check (contact_phone ~ '^7[0-9]{8}$'),
  logo_url text check (
    logo_url is null
    or (logo_url ~ '^data:image/(jpeg|png|webp);base64,' and octet_length(logo_url) <= 400000)
  ),
  status public.structure_status not null default 'active',
  invite_code text not null unique check (invite_code ~ '^[A-Z0-9]{4,12}$'),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint org_structures_not_own_parent check (parent_id is null or parent_id <> id)
);

create unique index org_structures_name_key
  on public.org_structures (organization_id, lower(btrim(name)));
create index org_structures_parent_idx on public.org_structures (parent_id);

create trigger org_structures_updated_at
  before update on public.org_structures
  for each row execute function private.set_updated_at();

create table public.structure_roles (
  structure_id uuid not null references public.org_structures (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.structure_role not null,
  created_at timestamptz not null default now(),
  primary key (structure_id, user_id, role)
);

create index structure_roles_user_idx on public.structure_roles (user_id);

-- Fichier central : une fiche par personne et par organisation.
create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Attribué à la première adhésion validée : « AFP-000123 ».
  member_number text,
  status public.org_member_status not null default 'pending',
  region text check (char_length(region) <= 60),
  departement text check (char_length(departement) <= 60),
  commune text check (char_length(commune) <= 80),
  localite text check (char_length(localite) <= 80),
  -- Date d'adhésion (première validation).
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id),
  unique (organization_id, member_number)
);

create index organization_members_user_idx on public.organization_members (user_id);

create trigger organization_members_updated_at
  before update on public.organization_members
  for each row execute function private.set_updated_at();

-- Appartenance à une structure, avec son historique (entrée, sortie, changement).
create table public.structure_members (
  id uuid primary key default gen_random_uuid(),
  structure_id uuid not null references public.org_structures (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status public.structure_member_status not null default 'pending',
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles (id) on delete set null,
  left_at timestamptz,
  left_reason text check (char_length(left_reason) <= 200),
  -- Changement de structure : la nouvelle appartenance.
  moved_to uuid references public.structure_members (id) on delete set null
);

create unique index structure_members_open_idx
  on public.structure_members (structure_id, user_id) where status in ('pending', 'active');
create index structure_members_user_idx on public.structure_members (user_id);
create index structure_members_structure_idx on public.structure_members (structure_id, status);

-- Aucune lecture directe : tout passe par les fonctions de ce fichier.
alter table public.organizations enable row level security;
alter table public.organization_roles enable row level security;
alter table public.org_structures enable row level security;
alter table public.structure_roles enable row level security;
alter table public.organization_members enable row level security;
alter table public.structure_members enable row level security;
revoke all on public.organizations, public.organization_roles, public.org_structures,
  public.structure_roles, public.organization_members, public.structure_members
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Codes d’invitation des structures (lien /rejoindre/CODE)
-- ---------------------------------------------------------------------------

create or replace function private.invite_code_taken(p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.org_structures where invite_code = p_code)
$$;

create or replace function private.fresh_invite_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  candidate text;
begin
  loop
    candidate := private.random_invite_code();
    exit when not private.invite_code_taken(candidate);
  end loop;
  return candidate;
end;
$$;


-- ---------------------------------------------------------------------------
-- Droits
-- ---------------------------------------------------------------------------

create or replace function private.has_org_role(p_org uuid, p_roles public.org_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_roles r
    where r.organization_id = p_org and r.user_id = private.active_uid()
      and r.role = any (p_roles)
  )
$$;

create or replace function private.is_org_admin(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_org_role(p_org, array['org_admin']::public.org_role[])
$$;

-- La structure et toutes celles au-dessus d'elle (rattachements).
create or replace function private.structure_ancestors(p_structure uuid)
returns table (id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive up (id, parent_id, depth) as (
    select s.id, s.parent_id, 0 from public.org_structures s where s.id = p_structure
    union all
    select s.id, s.parent_id, up.depth + 1
    from public.org_structures s join up on s.id = up.parent_id
    where up.depth < 20
  )
  select up.id from up
$$;

-- La structure et toutes celles qui en dépendent.
create or replace function private.structure_descendants(p_structure uuid)
returns table (id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive down (id, depth) as (
    select s.id, 0 from public.org_structures s where s.id = p_structure
    union all
    select s.id, down.depth + 1
    from public.org_structures s join down on s.parent_id = down.id
    where down.depth < 20
  )
  select down.id from down
$$;

-- Gère la structure : admin général de l'organisation, ou rôle dans la structure ou dans
-- une structure dont elle dépend.
create or replace function private.manages_structure(p_structure uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.active_uid() is not null and (
    exists (
      select 1 from public.org_structures s
      where s.id = p_structure and private.is_org_admin(s.organization_id)
    )
    or exists (
      select 1 from public.structure_roles r
      where r.user_id = private.active_uid()
        and r.structure_id in (select a.id from private.structure_ancestors(p_structure) a)
    )
  )
$$;

create or replace function private.require_organization(p_org uuid)
returns public.organizations
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.organizations;
begin
  select * into o from public.organizations where id = p_org;
  if not found then
    raise exception 'Cette organisation est introuvable.' using errcode = 'P0002';
  end if;
  return o;
end;
$$;

create or replace function private.require_org_by_slug(p_slug text)
returns public.organizations
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.organizations;
begin
  select * into o from public.organizations where slug = lower(btrim(coalesce(p_slug, '')));
  if not found then
    raise exception 'Cette organisation est introuvable.' using errcode = 'P0002';
  end if;
  return o;
end;
$$;

create or replace function private.require_org_admin(p_org uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
begin
  if not private.is_org_admin(p_org) then
    raise exception 'Réservé à l’administration de l’organisation.'
      using errcode = '42501', hint = 'access_denied:organization';
  end if;
  return uid;
end;
$$;

create or replace function private.require_structure(p_structure uuid)
returns public.org_structures
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.org_structures;
begin
  select * into s from public.org_structures where id = p_structure;
  if not found then
    raise exception 'Cette structure est introuvable.' using errcode = 'P0002';
  end if;
  return s;
end;
$$;

create or replace function private.require_manage_structure(p_structure uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
begin
  if not private.manages_structure(p_structure) then
    raise exception 'Vous ne gérez pas cette structure.'
      using errcode = '42501', hint = 'access_denied:structure';
  end if;
  return uid;
end;
$$;

-- Compte actif d'après un numéro (9 chiffres, commence par 7).
create or replace function private.account_by_phone(p_phone text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  found_id uuid;
begin
  if digits ~ '^221[0-9]{9}$' then
    digits := substr(digits, 4);
  end if;
  if digits !~ '^7[0-9]{8}$' then
    raise exception 'Numéro invalide : 9 chiffres commençant par 7.' using errcode = '22023';
  end if;
  select p.id into found_id from public.profiles p
  where p.phone = digits and p.deleted_at is null and not p.is_suspended;
  if found_id is null then
    raise exception 'Aucun compte actif avec ce numéro. La personne doit d’abord avoir un compte (Membres → Ajouter, ou lien d’invitation).'
      using errcode = 'P0002';
  end if;
  return found_id;
end;
$$;

create or replace function private.org_image(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  image text := nullif(btrim(coalesce(p_value, '')), '');
begin
  if image is not null and (
    image !~ '^data:image/(jpeg|png|webp);base64,' or octet_length(image) > 400000
  ) then
    raise exception 'Image invalide ou trop lourde.' using errcode = '22023';
  end if;
  return image;
end;
$$;

-- « AFP – Mouvement des femmes » : début des notifications d'une structure.
create or replace function private.structure_label(p_structure uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select o.short_name || ' – ' || s.name
  from public.org_structures s join public.organizations o on o.id = s.organization_id
  where s.id = p_structure
$$;

create or replace function private.org_json(o public.organizations)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', o.id, 'name', o.name, 'shortName', o.short_name, 'slug', o.slug,
    'color', o.color, 'logoUrl', o.logo_url, 'isSuspended', o.is_suspended
  )
$$;

create or replace function private.structure_json(s public.org_structures)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id, 'organizationId', s.organization_id, 'parentId', s.parent_id,
    'parentName', (select p.name from public.org_structures p where p.id = s.parent_id),
    'name', s.name, 'type', s.structure_type, 'description', s.description,
    'contactPhone', s.contact_phone, 'logoUrl', s.logo_url, 'status', s.status,
    'inviteCode', s.invite_code, 'createdAt', s.created_at,
    'memberCount', (select count(*) from public.structure_members m
                    where m.structure_id = s.id and m.status = 'active'),
    'pendingCount', (select count(*) from public.structure_members m
                     where m.structure_id = s.id and m.status = 'pending'),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', r.user_id, 'role', r.role, 'firstName', p.first_name,
        'lastName', p.last_name, 'phone', p.phone
      ) order by r.role, p.last_name)
      from public.structure_roles r join public.profiles p on p.id = r.user_id
      where r.structure_id = s.id
    ), '[]'::jsonb)
  )
$$;

-- ---------------------------------------------------------------------------
-- Lectures publiques (avant la connexion) : seulement le nom, le sigle, le logo et la
-- couleur, pour habiller les écrans de connexion. Jamais de membre ni de chiffre.
-- ---------------------------------------------------------------------------

create or replace function public.organization_branding(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'name', o.name, 'shortName', o.short_name, 'slug', o.slug,
    'color', o.color, 'logoUrl', o.logo_url
  )
  from public.organizations o
  where o.slug = lower(btrim(coalesce(p_slug, ''))) and not o.is_suspended
$$;

create or replace function public.invite_branding(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'name', o.name, 'shortName', o.short_name, 'slug', o.slug,
    'color', o.color, 'logoUrl', o.logo_url, 'structureName', s.name
  )
  from public.org_structures s join public.organizations o on o.id = s.organization_id
  where s.invite_code = upper(btrim(coalesce(p_code, '')))
    and s.status = 'active' and not o.is_suspended
$$;

-- Pour l'Edge Function auth-otp-send : code d'une structure qui accepte des adhésions.
create or replace function public.svc_structure_invite_valid(p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.invite_branding(p_code) is not null
$$;

-- ---------------------------------------------------------------------------
-- Super administrateur
-- ---------------------------------------------------------------------------

-- Les organisations et leurs chiffres globaux (jamais le fichier des militants).
create or replace function public.organizations_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_super_admin();
  return coalesce((
    select jsonb_agg(private.org_json(o) || jsonb_build_object(
      'createdAt', o.created_at,
      'memberCount', (select count(*) from public.organization_members m
                      where m.organization_id = o.id and m.status = 'active'),
      'pendingCount', (select count(*) from public.organization_members m
                       where m.organization_id = o.id and m.status = 'pending'),
      'structureCount', (select count(*) from public.org_structures s
                         where s.organization_id = o.id and s.status = 'active'),
      'admins', coalesce((
        select jsonb_agg(jsonb_build_object(
          'userId', r.user_id, 'role', r.role, 'firstName', p.first_name,
          'lastName', p.last_name, 'phone', p.phone
        ) order by p.last_name)
        from public.organization_roles r join public.profiles p on p.id = r.user_id
        where r.organization_id = o.id and r.role = 'org_admin'
      ), '[]'::jsonb)
    ) order by o.name)
    from public.organizations o
  ), '[]'::jsonb);
end;
$$;

create or replace function public.organization_save(
  p_id uuid,
  p_name text,
  p_short_name text,
  p_slug text,
  p_color text,
  p_logo text,
  p_is_suspended boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_super_admin();
  clean_name text := btrim(coalesce(p_name, ''));
  clean_short text := upper(btrim(coalesce(p_short_name, '')));
  clean_slug text := lower(btrim(coalesce(p_slug, '')));
  clean_color text := btrim(coalesce(p_color, '#1A5BA8'));
  logo text := private.org_image(p_logo);
  saved_id uuid := p_id;
begin
  perform private.inspect_input('name', clean_name);
  if char_length(clean_name) not between 3 and 80 then
    raise exception 'Le nom doit contenir entre 3 et 80 caractères.' using errcode = '22023';
  end if;
  if clean_short !~ '^[A-Z0-9]{2,10}$' then
    raise exception 'Le sigle : 2 à 10 lettres ou chiffres, sans espace (ex. AFP).'
      using errcode = '22023';
  end if;
  if clean_slug !~ '^[a-z0-9][a-z0-9-]{1,29}$' then
    raise exception 'L’adresse : 2 à 30 lettres minuscules, chiffres ou tirets (ex. afp).'
      using errcode = '22023';
  end if;
  if clean_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'Couleur invalide (format #1A5BA8).' using errcode = '22023';
  end if;
  if exists (select 1 from public.organizations o
             where (o.slug = clean_slug or o.short_name = clean_short)
               and (p_id is null or o.id <> p_id)) then
    raise exception 'Une organisation utilise déjà ce sigle ou cette adresse.'
      using errcode = '23505';
  end if;

  if p_id is null then
    insert into public.organizations (name, short_name, slug, color, logo_url, is_suspended)
    values (clean_name, clean_short, clean_slug, clean_color, logo, coalesce(p_is_suspended, false))
    returning id into saved_id;
  else
    perform private.require_organization(p_id);
    update public.organizations
    set name = clean_name, short_name = clean_short, slug = clean_slug, color = clean_color,
        logo_url = logo, is_suspended = coalesce(p_is_suspended, false)
    where id = p_id;
  end if;

  perform private.audit(uid, 'organization_saved',
    format(case when p_id is null then 'a créé l’organisation « %s »'
                else 'a modifié l’organisation « %s »' end, clean_name));
  return saved_id;
end;
$$;

-- Donne ou retire un rôle d'organisation à une personne (désignée par son numéro).
-- Super admin : tous les rôles. Admin général : admin financier et contrôleur.
create or replace function public.organization_set_role(
  p_org uuid, p_phone text, p_role public.org_role, p_grant boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  o public.organizations := private.require_organization(p_org);
  target uuid := private.account_by_phone(p_phone);
  label text := case p_role
    when 'org_admin' then 'administrateur général'
    when 'finance_admin' then 'administrateur financier'
    else 'contrôleur financier' end;
begin
  if not (private.is_super_admin()
          or (p_role <> 'org_admin' and private.is_org_admin(o.id))) then
    raise exception 'Vous ne pouvez pas attribuer ce rôle.'
      using errcode = '42501', hint = 'access_denied:organization';
  end if;

  if p_grant then
    insert into public.organization_roles (organization_id, user_id, role)
    values (o.id, target, p_role)
    on conflict do nothing;
    if found then
      perform private.notify(target, 'organization',
        o.short_name || ' : nouveau rôle',
        format('Vous êtes désormais %s de l’espace %s.', label, o.name),
        '/espace/' || o.slug || '/admin');
    end if;
  else
    if p_role = 'org_admin' and target = uid then
      raise exception 'Vous ne pouvez pas retirer votre propre rôle.' using errcode = '22023';
    end if;
    delete from public.organization_roles
    where organization_id = o.id and user_id = target and role = p_role;
  end if;

  perform private.audit(uid, 'org_role_changed',
    format('%s le rôle « %s » de %s dans « %s »',
      case when p_grant then 'a donné' else 'a retiré' end, label,
      private.full_name(target), o.name));
end;
$$;

-- ---------------------------------------------------------------------------
-- Espace d'une organisation (militants, responsables, administration)
-- ---------------------------------------------------------------------------

-- Ce que le compte connecté a dans chaque organisation : fiche, structures, rôles.
create or replace function public.my_organizations()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
begin
  return coalesce((
    select jsonb_agg(private.org_json(o) || jsonb_build_object(
      'memberNumber', m.member_number,
      'memberStatus', m.status,
      'joinedAt', m.joined_at,
      'region', m.region, 'departement', m.departement,
      'commune', m.commune, 'localite', m.localite,
      'orgRoles', coalesce((
        select jsonb_agg(r.role order by r.role) from public.organization_roles r
        where r.organization_id = o.id and r.user_id = uid
      ), '[]'::jsonb),
      'structures', coalesce((
        select jsonb_agg(jsonb_build_object(
          'membershipId', sm.id, 'structureId', s.id, 'name', s.name,
          'type', s.structure_type, 'status', sm.status,
          'structureStatus', s.status, 'since', coalesce(sm.decided_at, sm.requested_at)
        ) order by s.name)
        from public.structure_members sm join public.org_structures s on s.id = sm.structure_id
        where sm.user_id = uid and s.organization_id = o.id and sm.status in ('pending', 'active')
      ), '[]'::jsonb),
      'managedStructures', coalesce((
        select jsonb_agg(jsonb_build_object(
          'structureId', s.id, 'name', s.name, 'role', r.role
        ) order by s.name)
        from public.structure_roles r join public.org_structures s on s.id = r.structure_id
        where r.user_id = uid and s.organization_id = o.id and s.status <> 'archived'
      ), '[]'::jsonb)
    ) order by o.name)
    from public.organizations o
    left join public.organization_members m on m.organization_id = o.id and m.user_id = uid
    where not o.is_suspended
      and (
        m.id is not null
        or exists (select 1 from public.organization_roles r
                   where r.organization_id = o.id and r.user_id = uid)
        or exists (select 1 from public.structure_roles r
                   join public.org_structures s on s.id = r.structure_id
                   where s.organization_id = o.id and r.user_id = uid)
      )
  ), '[]'::jsonb);
end;
$$;

-- Administration de l'organisation : structures visibles (toutes pour l'admin général,
-- les siennes et leurs dépendances pour un responsable), chiffres, rôles d'organisation.
create or replace function public.organization_manage_view(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  o public.organizations := private.require_org_by_slug(p_slug);
  is_admin boolean := private.is_org_admin(o.id);
  visible uuid[];
begin
  if is_admin then
    select coalesce(array_agg(s.id), '{}') into visible
    from public.org_structures s where s.organization_id = o.id;
  else
    select coalesce(array_agg(distinct d.id), '{}') into visible
    from public.structure_roles r
    join public.org_structures s on s.id = r.structure_id and s.organization_id = o.id
    cross join lateral private.structure_descendants(s.id) d
    where r.user_id = uid;
    if cardinality(visible) = 0 then
      raise exception 'Vous n’avez pas de rôle dans cette organisation.'
        using errcode = '42501', hint = 'access_denied:organization';
    end if;
  end if;

  return jsonb_build_object(
    'organization', private.org_json(o),
    'isOrgAdmin', is_admin,
    'myOrgRoles', coalesce((
      select jsonb_agg(r.role) from public.organization_roles r
      where r.organization_id = o.id and r.user_id = uid
    ), '[]'::jsonb),
    'structures', coalesce((
      select jsonb_agg(private.structure_json(s) order by s.status, s.name)
      from public.org_structures s where s.id = any (visible)
    ), '[]'::jsonb),
    'stats', jsonb_build_object(
      'activeMembers', (
        select count(distinct sm.user_id) from public.structure_members sm
        where sm.structure_id = any (visible) and sm.status = 'active'),
      'pendingRequests', (
        select count(*) from public.structure_members sm
        where sm.structure_id = any (visible) and sm.status = 'pending'),
      'activeStructures', (
        select count(*) from public.org_structures s
        where s.id = any (visible) and s.status = 'active')
    ),
    'orgRoles', case when is_admin then coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', r.user_id, 'role', r.role, 'firstName', p.first_name,
        'lastName', p.last_name, 'phone', p.phone
      ) order by r.role, p.last_name)
      from public.organization_roles r join public.profiles p on p.id = r.user_id
      where r.organization_id = o.id
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

create or replace function public.structure_save(
  p_org uuid,
  p_id uuid,
  p_name text,
  p_type public.structure_type,
  p_parent uuid,
  p_description text,
  p_contact_phone text,
  p_logo text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.organizations := private.require_organization(p_org);
  uid uuid := private.require_org_admin(o.id);
  clean_name text := btrim(coalesce(p_name, ''));
  clean_description text := nullif(btrim(coalesce(p_description, '')), '');
  phone text := nullif(regexp_replace(coalesce(p_contact_phone, ''), '\D', '', 'g'), '');
  logo text := private.org_image(p_logo);
  saved_id uuid := p_id;
begin
  perform private.inspect_input('name', clean_name);
  perform private.inspect_input('description', clean_description);
  if char_length(clean_name) not between 2 and 80 then
    raise exception 'Le nom doit contenir entre 2 et 80 caractères.' using errcode = '22023';
  end if;
  if char_length(coalesce(clean_description, '')) > 300 then
    raise exception 'La description ne peut pas dépasser 300 caractères.' using errcode = '22023';
  end if;
  if phone is not null and phone !~ '^7[0-9]{8}$' then
    raise exception 'Téléphone de contact : 9 chiffres commençant par 7.' using errcode = '22023';
  end if;
  if exists (select 1 from public.org_structures s
             where s.organization_id = o.id and lower(btrim(s.name)) = lower(clean_name)
               and (p_id is null or s.id <> p_id)) then
    raise exception 'Une structure porte déjà ce nom.' using errcode = '23505';
  end if;
  if p_parent is not null then
    if not exists (select 1 from public.org_structures s
                   where s.id = p_parent and s.organization_id = o.id) then
      raise exception 'Structure de rattachement introuvable.' using errcode = '22023';
    end if;
    if p_id is not null and p_parent in (select d.id from private.structure_descendants(p_id) d) then
      raise exception 'Une structure ne peut pas être rattachée à elle-même ou à une structure qui en dépend.'
        using errcode = '22023';
    end if;
  end if;

  if p_id is null then
    insert into public.org_structures (organization_id, parent_id, name, structure_type,
      description, contact_phone, logo_url, invite_code, created_by)
    values (o.id, p_parent, clean_name, p_type, clean_description, phone, logo,
      private.fresh_invite_code(), uid)
    returning id into saved_id;
  else
    if not exists (select 1 from public.org_structures s
                   where s.id = p_id and s.organization_id = o.id) then
      raise exception 'Cette structure est introuvable.' using errcode = 'P0002';
    end if;
    update public.org_structures
    set name = clean_name, structure_type = p_type, parent_id = p_parent,
        description = clean_description, contact_phone = phone, logo_url = logo
    where id = p_id;
  end if;

  perform private.audit(uid, 'structure_saved',
    format(case when p_id is null then 'a créé la structure « %s » (%s)'
                else 'a modifié la structure « %s » (%s)' end, clean_name, o.short_name));
  return saved_id;
end;
$$;

create or replace function public.structure_set_status(p_id uuid, p_status public.structure_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.org_structures := private.require_structure(p_id);
  uid uuid := private.require_org_admin(s.organization_id);
begin
  if s.status = p_status then
    return;
  end if;
  update public.org_structures set status = p_status where id = s.id;
  -- Archivée : les demandes en attente sont refusées.
  if p_status = 'archived' then
    update public.structure_members
    set status = 'rejected', decided_at = now(), decided_by = uid
    where structure_id = s.id and status = 'pending';
  end if;
  perform private.audit(uid, 'structure_saved',
    format('a %s la structure « %s »',
      case p_status when 'active' then 'réactivé' when 'suspended' then 'suspendu'
                    else 'archivé' end, s.name));
end;
$$;

create or replace function public.structure_set_role(
  p_structure uuid, p_phone text, p_role public.structure_role, p_grant boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.org_structures := private.require_structure(p_structure);
  uid uuid := private.require_org_admin(s.organization_id);
  o public.organizations := private.require_organization(s.organization_id);
  target uuid := private.account_by_phone(p_phone);
  label text := case p_role
    when 'responsable' then 'responsable'
    when 'tresorier' then 'trésorier'
    when 'secretaire' then 'secrétaire'
    else 'gestionnaire des membres' end;
begin
  if p_grant then
    insert into public.structure_roles (structure_id, user_id, role)
    values (s.id, target, p_role)
    on conflict do nothing;
    if found then
      perform private.notify(target, 'organization',
        private.structure_label(s.id),
        format('Vous êtes désormais %s de cette structure.', label),
        '/espace/' || o.slug || '/structures/' || s.id);
    end if;
  else
    delete from public.structure_roles
    where structure_id = s.id and user_id = target and role = p_role;
  end if;
  perform private.audit(uid, 'org_role_changed',
    format('%s le rôle « %s » de %s dans « %s » (%s)',
      case when p_grant then 'a donné' else 'a retiré' end, label,
      private.full_name(target), s.name, o.short_name));
end;
$$;

create or replace function public.structure_regenerate_invite(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.org_structures := private.require_structure(p_id);
  uid uuid := private.require_manage_structure(s.id);
  code text := private.fresh_invite_code();
begin
  update public.org_structures set invite_code = code where id = s.id;
  perform private.audit(uid, 'structure_saved',
    format('a changé le lien d’invitation de « %s »', s.name));
  return code;
end;
$$;

-- Une structure et ses militants (en attente, actifs), pour ceux qui la gèrent.
create or replace function public.structure_view(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.org_structures := private.require_structure(p_id);
  uid uuid := private.require_manage_structure(s.id);
  o public.organizations := private.require_organization(s.organization_id);
begin
  return jsonb_build_object(
    'organization', private.org_json(o),
    'isOrgAdmin', private.is_org_admin(o.id),
    'structure', private.structure_json(s),
    'children', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'status', c.status)
                       order by c.name)
      from public.org_structures c where c.parent_id = s.id
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', sm.id, 'userId', sm.user_id, 'status', sm.status,
        'requestedAt', sm.requested_at, 'decidedAt', sm.decided_at,
        'firstName', p.first_name, 'lastName', p.last_name, 'phone', p.phone,
        'avatarUrl', p.avatar_url, 'memberNumber', m.member_number,
        'region', m.region, 'departement', m.departement,
        'commune', m.commune, 'localite', m.localite
      ) order by sm.status desc, p.last_name, p.first_name)
      from public.structure_members sm
      join public.profiles p on p.id = sm.user_id
      left join public.organization_members m
        on m.organization_id = o.id and m.user_id = sm.user_id
      where sm.structure_id = s.id and sm.status in ('pending', 'active')
    ), '[]'::jsonb)
  );
end;
$$;

-- Numéro de membre suivant : « AFP-000123 ».
create or replace function private.next_member_number(p_org uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.organizations;
begin
  update public.organizations
  set next_member_number = next_member_number + 1
  where id = p_org
  returning * into o;
  return o.short_name || '-' || lpad((o.next_member_number - 1)::text, 6, '0');
end;
$$;

create or replace function public.structure_member_decide(p_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sm public.structure_members;
  s public.org_structures;
  o public.organizations;
  uid uuid;
  om public.organization_members;
begin
  select * into sm from public.structure_members where id = p_id for update;
  if not found then
    raise exception 'Cette demande est introuvable.' using errcode = 'P0002';
  end if;
  s := private.require_structure(sm.structure_id);
  uid := private.require_manage_structure(s.id);
  o := private.require_organization(s.organization_id);
  if sm.status <> 'pending' then
    raise exception 'Cette demande a déjà été traitée.' using errcode = '22023';
  end if;
  if p_accept and s.status <> 'active' then
    raise exception 'Cette structure n’accepte pas de nouveaux membres pour le moment.'
      using errcode = '22023';
  end if;

  update public.structure_members
  set status = case when p_accept then 'active' else 'rejected' end::public.structure_member_status,
      decided_at = now(), decided_by = uid
  where id = sm.id;

  if p_accept then
    select * into om from public.organization_members
    where organization_id = o.id and user_id = sm.user_id for update;
    if not found then
      insert into public.organization_members (organization_id, user_id)
      values (o.id, sm.user_id)
      returning * into om;
    end if;
    if om.member_number is null then
      update public.organization_members
      set member_number = private.next_member_number(o.id), status = 'active',
          joined_at = coalesce(joined_at, now())
      where id = om.id
      returning * into om;
    elsif om.status <> 'active' then
      update public.organization_members set status = 'active' where id = om.id
      returning * into om;
    end if;
    perform private.notify(sm.user_id, 'organization', private.structure_label(s.id),
      format('Votre adhésion est validée. Votre numéro de membre : %s.', om.member_number),
      '/espace/' || o.slug);
  else
    -- Fiche encore en attente et plus aucune demande : elle est retirée.
    delete from public.organization_members m
    where m.organization_id = o.id and m.user_id = sm.user_id and m.status = 'pending'
      and m.member_number is null
      and not exists (
        select 1 from public.structure_members x
        join public.org_structures xs on xs.id = x.structure_id
        where x.user_id = sm.user_id and xs.organization_id = o.id
          and x.status in ('pending', 'active')
      );
    perform private.notify(sm.user_id, 'organization', private.structure_label(s.id),
      'Votre demande d’adhésion n’a pas été retenue. Rapprochez-vous du responsable de la structure.',
      null);
  end if;

  perform private.audit(uid, 'structure_member_decided',
    format('a %s une demande d’adhésion à « %s » (%s)',
      case when p_accept then 'validé' else 'refusé' end, s.name, o.short_name));
end;
$$;

-- Retire un militant d'une structure (l'historique est gardé).
create or replace function public.structure_member_remove(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sm public.structure_members;
  s public.org_structures;
  uid uuid;
  reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into sm from public.structure_members where id = p_id for update;
  if not found or sm.status <> 'active' then
    raise exception 'Ce membre n’est plus dans la structure.' using errcode = 'P0002';
  end if;
  s := private.require_structure(sm.structure_id);
  uid := private.require_manage_structure(s.id);
  perform private.inspect_input('reason', reason);
  if char_length(coalesce(reason, '')) > 200 then
    raise exception 'Le motif ne peut pas dépasser 200 caractères.' using errcode = '22023';
  end if;
  update public.structure_members
  set status = 'left', left_at = now(), left_reason = reason
  where id = sm.id;
  perform private.notify(sm.user_id, 'organization', private.structure_label(s.id),
    'Vous ne faites plus partie de cette structure.' ||
      coalesce(' Motif : ' || reason, ''),
    null);
  perform private.audit(uid, 'structure_member_decided',
    format('a retiré un membre de « %s »', s.name));
end;
$$;

-- Change un militant de structure (admin général) : l'ancienne appartenance est close et
-- pointe vers la nouvelle.
create or replace function public.structure_member_move(p_id uuid, p_target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sm public.structure_members;
  s public.org_structures;
  target public.org_structures := private.require_structure(p_target);
  uid uuid;
  new_id uuid;
begin
  select * into sm from public.structure_members where id = p_id for update;
  if not found or sm.status not in ('active', 'pending') then
    raise exception 'Ce membre n’est plus dans la structure.' using errcode = 'P0002';
  end if;
  s := private.require_structure(sm.structure_id);
  uid := private.require_org_admin(s.organization_id);
  if target.organization_id <> s.organization_id or target.status <> 'active' then
    raise exception 'Choisissez une structure active de la même organisation.'
      using errcode = '22023';
  end if;
  if target.id = s.id then
    return;
  end if;
  if exists (select 1 from public.structure_members x
             where x.structure_id = target.id and x.user_id = sm.user_id
               and x.status in ('pending', 'active')) then
    raise exception 'Cette personne est déjà dans la structure choisie.' using errcode = '23505';
  end if;

  insert into public.structure_members (structure_id, user_id, status, requested_at,
    decided_at, decided_by)
  values (target.id, sm.user_id, sm.status, now(),
    case when sm.status = 'active' then now() end,
    case when sm.status = 'active' then uid end)
  returning id into new_id;

  update public.structure_members
  set status = 'left', left_at = now(), left_reason = 'Changement de structure : ' || target.name,
      moved_to = new_id
  where id = sm.id;

  perform private.notify(sm.user_id, 'organization', private.structure_label(target.id),
    format('Vous avez été transféré de « %s » vers « %s ».', s.name, target.name), null);
  perform private.audit(uid, 'structure_member_decided',
    format('a transféré un membre de « %s » vers « %s »', s.name, target.name));
end;
$$;

-- Fichier central (admin général) : recherche par nom, numéro de téléphone ou de membre,
-- filtres par structure, département et statut ; 50 fiches par page.
create or replace function public.organization_members_page(
  p_org uuid,
  p_query text default null,
  p_structure uuid default null,
  p_departement text default null,
  p_status public.org_member_status default null,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.organizations := private.require_organization(p_org);
  uid uuid := private.require_org_admin(o.id);
  q text := nullif(lower(btrim(coalesce(p_query, ''))), '');
  page_size constant integer := 50;
  result jsonb;
  total bigint;
begin
  select count(*) into total
  from public.organization_members m
  join public.profiles p on p.id = m.user_id
  where m.organization_id = o.id
    and (p_status is null or m.status = p_status)
    and (p_departement is null or m.departement = p_departement)
    and (p_structure is null or exists (
      select 1 from public.structure_members sm
      where sm.user_id = m.user_id and sm.structure_id = p_structure
        and sm.status in ('pending', 'active')))
    and (q is null
      or lower(p.first_name || ' ' || p.last_name) like '%' || q || '%'
      or lower(p.last_name || ' ' || p.first_name) like '%' || q || '%'
      or (q ~ '[0-9]' and p.phone like '%' || regexp_replace(q, '\D', '', 'g') || '%')
      or lower(coalesce(m.member_number, '')) like '%' || q || '%');

  select coalesce(jsonb_agg(x.row_json order by x.sort_name), '[]'::jsonb) into result
  from (
    select jsonb_build_object(
      'id', m.id, 'userId', m.user_id, 'memberNumber', m.member_number, 'status', m.status,
      'firstName', p.first_name, 'lastName', p.last_name, 'phone', p.phone,
      'avatarUrl', p.avatar_url, 'region', m.region, 'departement', m.departement,
      'commune', m.commune, 'localite', m.localite, 'joinedAt', m.joined_at,
      'structures', coalesce((
        select jsonb_agg(jsonb_build_object(
          'membershipId', sm.id, 'structureId', s.id, 'name', s.name, 'status', sm.status
        ) order by s.name)
        from public.structure_members sm join public.org_structures s on s.id = sm.structure_id
        where sm.user_id = m.user_id and s.organization_id = o.id
          and sm.status in ('pending', 'active')
      ), '[]'::jsonb)
    ) as row_json, lower(p.last_name || ' ' || p.first_name) as sort_name
    from public.organization_members m
    join public.profiles p on p.id = m.user_id
    where m.organization_id = o.id
      and (p_status is null or m.status = p_status)
      and (p_departement is null or m.departement = p_departement)
      and (p_structure is null or exists (
        select 1 from public.structure_members sm
        where sm.user_id = m.user_id and sm.structure_id = p_structure
          and sm.status in ('pending', 'active')))
      and (q is null
        or lower(p.first_name || ' ' || p.last_name) like '%' || q || '%'
        or lower(p.last_name || ' ' || p.first_name) like '%' || q || '%'
        or (q ~ '[0-9]' and p.phone like '%' || regexp_replace(q, '\D', '', 'g') || '%')
        or lower(coalesce(m.member_number, '')) like '%' || q || '%')
    order by lower(p.last_name || ' ' || p.first_name)
    offset greatest(coalesce(p_offset, 0), 0)
    limit page_size
  ) x;

  return jsonb_build_object('rows', result, 'total', total, 'pageSize', page_size);
end;
$$;

-- Fiche d'un militant (admin général) : localisation et statut.
create or replace function public.organization_member_update(
  p_id uuid,
  p_region text,
  p_departement text,
  p_commune text,
  p_localite text,
  p_status public.org_member_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.organization_members;
  uid uuid;
begin
  select * into m from public.organization_members where id = p_id;
  if not found then
    raise exception 'Cette fiche est introuvable.' using errcode = 'P0002';
  end if;
  uid := private.require_org_admin(m.organization_id);
  if p_status = 'pending' and m.status <> 'pending' then
    raise exception 'Statut invalide.' using errcode = '22023';
  end if;
  perform private.inspect_input('commune', p_commune);
  perform private.inspect_input('localite', p_localite);
  update public.organization_members
  set region = nullif(btrim(coalesce(p_region, '')), ''),
      departement = nullif(btrim(coalesce(p_departement, '')), ''),
      commune = nullif(btrim(coalesce(p_commune, '')), ''),
      localite = nullif(btrim(coalesce(p_localite, '')), ''),
      status = p_status
  where id = m.id;
  perform private.audit(uid, 'structure_member_decided',
    'a modifié la fiche d’un membre de l’organisation');
end;
$$;

-- ---------------------------------------------------------------------------
-- Adhésion par le lien d'une structure
-- ---------------------------------------------------------------------------

create or replace function public.structure_join_preview(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  s public.org_structures;
  o public.organizations;
  m public.organization_members;
begin
  select * into s from public.org_structures
  where invite_code = upper(btrim(coalesce(p_code, '')));
  if not found then
    return null;
  end if;
  o := private.require_organization(s.organization_id);
  select * into m from public.organization_members
  where organization_id = o.id and user_id = uid;
  return jsonb_build_object(
    'organization', private.org_json(o),
    'structure', jsonb_build_object(
      'id', s.id, 'name', s.name, 'type', s.structure_type, 'description', s.description,
      'logoUrl', s.logo_url, 'status', s.status,
      'parentName', (select p.name from public.org_structures p where p.id = s.parent_id)
    ),
    'open', s.status = 'active' and not o.is_suspended,
    'myStatus', (
      select sm.status from public.structure_members sm
      where sm.structure_id = s.id and sm.user_id = uid and sm.status in ('pending', 'active')
    ),
    'myFile', case when m.id is null then null else jsonb_build_object(
      'memberNumber', m.member_number, 'region', m.region, 'departement', m.departement,
      'commune', m.commune, 'localite', m.localite
    ) end
  );
end;
$$;

create or replace function public.structure_join(
  p_code text,
  p_region text,
  p_departement text,
  p_commune text,
  p_localite text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  s public.org_structures;
  o public.organizations;
  clean_region text := nullif(btrim(coalesce(p_region, '')), '');
  clean_departement text := nullif(btrim(coalesce(p_departement, '')), '');
  clean_commune text := nullif(btrim(coalesce(p_commune, '')), '');
  clean_localite text := nullif(btrim(coalesce(p_localite, '')), '');
begin
  select * into s from public.org_structures
  where invite_code = upper(btrim(coalesce(p_code, '')));
  if not found then
    raise exception 'Code d’invitation inconnu.' using errcode = 'P0002';
  end if;
  o := private.require_organization(s.organization_id);
  if s.status <> 'active' or o.is_suspended then
    raise exception 'Cette structure n’accepte pas de nouveaux membres pour le moment.'
      using errcode = '22023';
  end if;
  perform private.inspect_input('commune', clean_commune);
  perform private.inspect_input('localite', clean_localite);
  if clean_region is null or clean_departement is null then
    raise exception 'Indiquez votre région et votre département.' using errcode = '22023';
  end if;
  if char_length(coalesce(clean_commune, '')) > 80 or char_length(coalesce(clean_localite, '')) > 80
     or char_length(clean_region) > 60 or char_length(clean_departement) > 60 then
    raise exception 'Texte trop long.' using errcode = '22023';
  end if;
  if exists (select 1 from public.structure_members sm
             where sm.structure_id = s.id and sm.user_id = uid
               and sm.status in ('pending', 'active')) then
    raise exception 'Vous avez déjà une demande ou une adhésion dans cette structure.'
      using errcode = '23505';
  end if;

  insert into public.organization_members (organization_id, user_id, region, departement,
    commune, localite)
  values (o.id, uid, clean_region, clean_departement, clean_commune, clean_localite)
  on conflict (organization_id, user_id) do update
  set region = excluded.region, departement = excluded.departement,
      commune = coalesce(excluded.commune, public.organization_members.commune),
      localite = coalesce(excluded.localite, public.organization_members.localite);

  insert into public.structure_members (structure_id, user_id) values (s.id, uid);

  -- Ceux qui gèrent la structure (ou une structure dont elle dépend) et l'admin général.
  insert into public.notifications (user_id, type, title, body, link)
  select distinct manager, 'organization', private.structure_label(s.id),
    format('Nouvelle demande d’adhésion de %s.', private.full_name(uid)),
    '/espace/' || o.slug || '/structures/' || s.id
  from (
    select r.user_id as manager from public.structure_roles r
    where r.structure_id in (select a.id from private.structure_ancestors(s.id) a)
    union
    select r.user_id from public.organization_roles r
    where r.organization_id = o.id and r.role = 'org_admin'
  ) managers
  where manager <> uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Accès aux fonctions
-- ---------------------------------------------------------------------------

revoke all on function
  public.organization_branding(text),
  public.invite_branding(text),
  public.svc_structure_invite_valid(text),
  public.organizations_list(),
  public.organization_save(uuid, text, text, text, text, text, boolean),
  public.organization_set_role(uuid, text, public.org_role, boolean),
  public.my_organizations(),
  public.organization_manage_view(text),
  public.structure_save(uuid, uuid, text, public.structure_type, uuid, text, text, text),
  public.structure_set_status(uuid, public.structure_status),
  public.structure_set_role(uuid, text, public.structure_role, boolean),
  public.structure_regenerate_invite(uuid),
  public.structure_view(uuid),
  public.structure_member_decide(uuid, boolean),
  public.structure_member_remove(uuid, text),
  public.structure_member_move(uuid, uuid),
  public.organization_members_page(uuid, text, uuid, text, public.org_member_status, integer),
  public.organization_member_update(uuid, text, text, text, text, public.org_member_status),
  public.structure_join_preview(text),
  public.structure_join(text, text, text, text, text)
from public, anon;

grant execute on function
  public.organization_branding(text),
  public.invite_branding(text)
to anon, authenticated;

grant execute on function public.svc_structure_invite_valid(text) to service_role;

grant execute on function
  public.organizations_list(),
  public.organization_save(uuid, text, text, text, text, text, boolean),
  public.organization_set_role(uuid, text, public.org_role, boolean),
  public.my_organizations(),
  public.organization_manage_view(text),
  public.structure_save(uuid, uuid, text, public.structure_type, uuid, text, text, text),
  public.structure_set_status(uuid, public.structure_status),
  public.structure_set_role(uuid, text, public.structure_role, boolean),
  public.structure_regenerate_invite(uuid),
  public.structure_view(uuid),
  public.structure_member_decide(uuid, boolean),
  public.structure_member_remove(uuid, text),
  public.structure_member_move(uuid, uuid),
  public.organization_members_page(uuid, text, uuid, text, public.org_member_status, integer),
  public.organization_member_update(uuid, text, text, text, text, public.org_member_status),
  public.structure_join_preview(text),
  public.structure_join(text, text, text, text, text)
to authenticated;
