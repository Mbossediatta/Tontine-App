-- Le super admin (exploitant technique, le développeur) peut CONSULTER toutes les données
-- de l'AFP : structures, militants, caisses, paiements et reçus (demande du 2026-11-10).
-- Il n'agit pas à la place de l'AFP : créer une structure, valider une adhésion,
-- enregistrer ou annuler un paiement restent réservés aux rôles de l'organisation.

create or replace function private.views_structure_money(p_structure uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_super_admin() or private.manages_structure(p_structure) or exists (
    select 1 from public.org_structures s
    where s.id = p_structure
      and private.has_org_role(s.organization_id,
            array['org_admin', 'finance_admin', 'controller']::public.org_role[])
  )
$$;

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
  sees_all boolean := private.has_org_role(o.id,
    array['org_admin', 'finance_admin', 'controller']::public.org_role[])
    or private.is_super_admin();
  visible uuid[];
begin
  if sees_all then
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
    -- Super admin : consultation seule (aucune action de gestion).
    'readOnly', private.is_super_admin() and not is_admin,
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
    'orgRoles', case when is_admin or private.is_super_admin() then coalesce((
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

create or replace function public.structure_view(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.org_structures := private.require_structure(p_id);
  uid uuid := private.require_uid();
  o public.organizations := private.require_organization(s.organization_id);
begin
  if not private.views_structure_money(s.id) then
    raise exception 'Vous ne gérez pas cette structure.'
      using errcode = '42501', hint = 'access_denied:structure';
  end if;
  return jsonb_build_object(
    'organization', private.org_json(o),
    'isOrgAdmin', private.is_org_admin(o.id),
    'canManage', private.manages_structure(s.id),
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
  uid uuid := private.require_uid();
  q text := nullif(lower(btrim(coalesce(p_query, ''))), '');
  page_size constant integer := 50;
  result jsonb;
  total bigint;
begin
  if not (private.is_org_admin(o.id) or private.is_super_admin()) then
    raise exception 'Réservé à l’administration de l’organisation.'
      using errcode = '42501', hint = 'access_denied:organization';
  end if;
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
