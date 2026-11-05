-- Communautés : création et modification par le super administrateur.
-- Référence : saveCommunity dans tontine-pwa/src/services/mock/admin.mock.ts.
-- La lecture passe par les tables (RLS communities_select, community_admins_select).
--
-- Retirer un admin d'une communauté ne touche pas aux groupes dont il est l'admin :
-- les deux rôles sont indépendants.

create or replace function public.community_save(
  p_id uuid,
  p_name text,
  p_description text,
  p_admin_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.active_uid();
  clean_name text := btrim(coalesce(p_name, ''));
  clean_description text := nullif(btrim(coalesce(p_description, '')), '');
  admin_ids uuid[];
  previous_ids uuid[] := '{}';
  saved_id uuid := p_id;
begin
  if actor is null or not private.is_super_admin() then
    raise exception 'Action réservée au super administrateur' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct a), '{}') into admin_ids
  from unnest(coalesce(p_admin_ids, '{}')) a
  where a is not null;

  if char_length(clean_name) not between 2 and 60 then
    raise exception 'Le nom doit contenir entre 2 et 60 caractères.' using errcode = '22023';
  end if;
  if char_length(coalesce(clean_description, '')) > 300 then
    raise exception 'La description ne peut pas dépasser 300 caractères.' using errcode = '22023';
  end if;
  if cardinality(admin_ids) = 0 then
    raise exception 'Affectez au moins un administrateur à cette communauté.'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(admin_ids) a
    where not exists (
      select 1 from public.profiles p
      where p.id = a and p.global_role = 'admin'
        and not p.is_suspended and p.deleted_at is null
    )
  ) then
    raise exception 'Une communauté ne peut être confiée qu’à des admins actifs.'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from public.communities c
    where lower(btrim(c.name)) = lower(clean_name)
      and (p_id is null or c.id <> p_id)
  ) then
    raise exception 'Une communauté porte déjà ce nom.' using errcode = '23505';
  end if;

  if p_id is null then
    insert into public.communities (name, description)
    values (clean_name, clean_description)
    returning id into saved_id;
  else
    update public.communities
    set name = clean_name, description = clean_description
    where id = p_id;
    if not found then
      raise exception 'Cette communauté est introuvable.' using errcode = 'P0002';
    end if;
    select coalesce(array_agg(ca.admin_id), '{}') into previous_ids
    from public.community_admins ca
    where ca.community_id = p_id;
    delete from public.community_admins ca
    where ca.community_id = p_id and ca.admin_id <> all (admin_ids);
  end if;

  insert into public.community_admins (community_id, admin_id)
  select saved_id, a from unnest(admin_ids) a
  on conflict do nothing;

  insert into public.notifications (user_id, type, title, body, link)
  select a, 'community', 'Nouvelle communauté',
    format('Vous avez été affecté à la communauté « %s ».', clean_name),
    '/admin/mes-groupes'
  from unnest(admin_ids) a
  where a <> all (previous_ids);

  insert into public.audit_log (actor_id, action, summary)
  values (
    actor,
    case when p_id is null then 'community_created' else 'community_updated' end::public.audit_action,
    format(
      case when p_id is null then 'a créé la communauté « %s »'
        else 'a modifié la communauté « %s »' end,
      clean_name
    )
  );

  return saved_id;
end;
$$;

revoke all on function public.community_save(uuid, text, text, uuid[]) from public, anon;
grant execute on function public.community_save(uuid, text, text, uuid[]) to authenticated;
