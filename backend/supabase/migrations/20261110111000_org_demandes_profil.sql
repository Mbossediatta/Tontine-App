-- Modification du profil avec validation (cahier § 7.6, point à arbitrer n° 3 : « le
-- membre peut modifier certaines informations, avec validation des données sensibles »).
--
-- - Modifiable directement (profil du compte) : photo, prénom, nom, langue.
-- - Soumis à validation : la localisation de la fiche de membre (région, département,
--   commune, localité), qui détermine son rattachement. Le militant envoie une demande ;
--   un responsable ou gestionnaire des membres d'une de ses structures, ou
--   l'administration générale, l'accepte ou la refuse. Tout est historisé.

create table public.org_profile_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Valeurs demandées (et valeurs d'avant, pour l'historique).
  changes jsonb not null,
  previous jsonb not null,
  note text check (char_length(note) <= 300),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  decision_note text check (char_length(decision_note) <= 300),
  created_at timestamptz not null default now()
);

create index org_profile_requests_org_idx on public.org_profile_requests (organization_id, status);
create unique index org_profile_requests_one_pending
  on public.org_profile_requests (organization_id, user_id) where status = 'pending';

alter table public.org_profile_requests enable row level security;
revoke all on public.org_profile_requests from anon, authenticated;

-- Peut traiter les demandes de ce membre : administration générale, ou responsable /
-- gestionnaire des membres d'une structure (ou d'une structure parente) du membre.
create or replace function private.handles_member_profile(p_org uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_org_admin(p_org) or exists (
    select 1 from public.structure_members sm
    join public.org_structures s on s.id = sm.structure_id
    where sm.user_id = p_user and sm.status = 'active' and s.organization_id = p_org
      and private.manages_structure(s.id)
  )
$$;

create or replace function private.profile_request_json(r public.org_profile_requests)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id, 'userId', r.user_id, 'member', private.full_name(r.user_id),
    'memberNumber', (select m.member_number from public.organization_members m
                     where m.organization_id = r.organization_id and m.user_id = r.user_id),
    'changes', r.changes, 'previous', r.previous, 'note', r.note, 'status', r.status,
    'decidedBy', private.full_name(r.decided_by), 'decidedAt', r.decided_at,
    'decisionNote', r.decision_note, 'createdAt', r.created_at)
$$;

-- Le militant demande une correction de sa localisation.
create or replace function public.my_profile_request_submit(
  p_slug text, p_region text, p_departement text, p_commune text, p_localite text, p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  o public.organizations := private.require_org_by_slug(p_slug);
  m public.organization_members;
  v_changes jsonb;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id uuid;
  target uuid;
begin
  select * into m from public.organization_members
  where organization_id = o.id and user_id = uid and status = 'active';
  if not found then
    raise exception 'Seuls les membres actifs peuvent demander une modification.'
      using errcode = '42501', hint = 'access_denied:organization';
  end if;
  perform private.inspect_input('commune', p_commune);
  perform private.inspect_input('localite', p_localite);
  perform private.inspect_input('note', v_note);
  if char_length(coalesce(v_note, '')) > 300 then
    raise exception 'Message trop long (300 caractères au plus).' using errcode = '22023';
  end if;
  v_changes := jsonb_build_object(
    'region', nullif(btrim(coalesce(p_region, '')), ''),
    'departement', nullif(btrim(coalesce(p_departement, '')), ''),
    'commune', nullif(btrim(coalesce(p_commune, '')), ''),
    'localite', nullif(btrim(coalesce(p_localite, '')), ''));
  if v_changes ->> 'region' is null or v_changes ->> 'departement' is null then
    raise exception 'Indiquez au moins la région et le département.' using errcode = '22023';
  end if;
  if v_changes = jsonb_build_object('region', m.region, 'departement', m.departement,
                                    'commune', m.commune, 'localite', m.localite) then
    raise exception 'Rien n’a changé.' using errcode = '22023';
  end if;
  if exists (select 1 from public.org_profile_requests r
             where r.organization_id = o.id and r.user_id = uid and r.status = 'pending') then
    raise exception 'Une demande est déjà en attente de validation.' using errcode = '23505';
  end if;

  insert into public.org_profile_requests (organization_id, user_id, changes, previous, note)
  values (o.id, uid, v_changes,
    jsonb_build_object('region', m.region, 'departement', m.departement,
      'commune', m.commune, 'localite', m.localite), v_note)
  returning id into v_id;

  -- Prévenir ceux qui gèrent ses structures (sinon l'administration générale).
  for target in
    select distinct r.user_id from public.structure_roles r
    join public.structure_members sm on sm.structure_id = r.structure_id
    where sm.user_id = uid and sm.status = 'active'
      and r.role in ('responsable', 'gestionnaire_membres') and r.user_id <> uid
    union
    select r.user_id from public.organization_roles r
    where r.organization_id = o.id and r.role = 'org_admin' and r.user_id <> uid
  loop
    perform private.notify(target, 'organization', o.short_name || ' – Fiche de membre',
      format('%s demande à corriger sa localisation.', private.full_name(uid)),
      '/espace/' || o.slug || '/admin/demandes-profil');
  end loop;
  return v_id;
end;
$$;

create or replace function public.my_profile_requests(p_slug text)
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
  return coalesce((
    select jsonb_agg(private.profile_request_json(r) order by r.created_at desc)
    from public.org_profile_requests r where r.organization_id = o.id and r.user_id = uid
  ), '[]'::jsonb);
end;
$$;

-- Demandes à traiter (et traitées récemment) par le compte connecté.
create or replace function public.org_profile_requests(p_slug text)
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
  return coalesce((
    select jsonb_agg(private.profile_request_json(r) order by (r.status <> 'pending'), r.created_at desc)
    from (
      select * from public.org_profile_requests r
      where r.organization_id = o.id and private.handles_member_profile(o.id, r.user_id)
        and (r.status = 'pending' or r.decided_at > now() - interval '90 days')
      order by r.created_at desc limit 200
    ) r
  ), '[]'::jsonb);
end;
$$;

create or replace function public.org_profile_request_decide(
  p_id uuid, p_approve boolean, p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  r public.org_profile_requests;
  o public.organizations;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into r from public.org_profile_requests where id = p_id for update;
  if not found then
    raise exception 'Demande introuvable.' using errcode = 'P0002';
  end if;
  o := private.require_organization(r.organization_id);
  if not private.handles_member_profile(o.id, r.user_id) or r.user_id = uid then
    raise exception 'Vous ne pouvez pas traiter cette demande.'
      using errcode = '42501', hint = 'access_denied:organization';
  end if;
  if r.status <> 'pending' then
    raise exception 'Cette demande est déjà traitée.' using errcode = '22023';
  end if;
  perform private.inspect_input('note', v_note);
  if not p_approve and (v_note is null or char_length(v_note) < 3) then
    raise exception 'Indiquez le motif du refus.' using errcode = '22023';
  end if;

  update public.org_profile_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      decided_by = uid, decided_at = now(), decision_note = v_note
  where id = r.id;
  if p_approve then
    update public.organization_members
    set region = r.changes ->> 'region', departement = r.changes ->> 'departement',
        commune = r.changes ->> 'commune', localite = r.changes ->> 'localite'
    where organization_id = o.id and user_id = r.user_id;
  end if;
  perform private.notify(r.user_id, 'organization', o.short_name || ' – Fiche de membre',
    case when p_approve then 'Votre demande de modification est acceptée : votre fiche est à jour.'
      else format('Votre demande de modification est refusée. Motif : %s', v_note) end,
    null);
  perform private.audit(uid, 'structure_member_decided',
    format('a %s la modification de fiche de %s',
      case when p_approve then 'accepté' else 'refusé' end, private.full_name(r.user_id)));
end;
$$;

revoke all on function
  public.my_profile_request_submit(text, text, text, text, text, text),
  public.my_profile_requests(text),
  public.org_profile_requests(text),
  public.org_profile_request_decide(uuid, boolean, text)
  from public, anon;
grant execute on function
  public.my_profile_request_submit(text, text, text, text, text, text),
  public.my_profile_requests(text),
  public.org_profile_requests(text),
  public.org_profile_request_decide(uuid, boolean, text)
  to authenticated;
