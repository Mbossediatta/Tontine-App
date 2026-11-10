-- L'administration financière (admin financier, contrôleur) voit aussi toutes les structures
-- dans l'Administration (lecture des caisses et des paiements), sans les droits de l'admin général.

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
    array['org_admin', 'finance_admin', 'controller']::public.org_role[]);
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
