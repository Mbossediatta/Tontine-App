-- Un responsable est aussi membre de son organisation.
--
-- Nommer quelqu'un administrateur général, financier, contrôleur (organization_roles) ou
-- responsable d'une structure (structure_roles) lui donnait le rôle sans fiche de membre :
-- son Espace affichait « Adhésion en attente de validation » et il n'avait pas de numéro.
-- Désormais, la nomination crée (ou réactive) sa fiche, active, avec son numéro AFP-000123.

create or replace function private.ensure_active_org_member(p_org uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  om public.organization_members;
begin
  select * into om from public.organization_members
  where organization_id = p_org and user_id = p_user
  for update;

  if not found then
    insert into public.organization_members (organization_id, user_id)
    values (p_org, p_user)
    returning * into om;
  end if;

  if om.member_number is null then
    update public.organization_members
    set member_number = private.next_member_number(p_org),
        status = 'active',
        joined_at = coalesce(joined_at, now())
    where id = om.id;
  elsif om.status <> 'active' then
    update public.organization_members
    set status = 'active', joined_at = coalesce(joined_at, now())
    where id = om.id;
  end if;
end;
$$;

create or replace function private.org_role_makes_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.ensure_active_org_member(new.organization_id, new.user_id);
  return new;
end;
$$;

create or replace function private.structure_role_makes_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.ensure_active_org_member(
    (select organization_id from public.org_structures where id = new.structure_id),
    new.user_id);
  return new;
end;
$$;

create trigger organization_roles_make_member
  after insert on public.organization_roles
  for each row execute function private.org_role_makes_member();

create trigger structure_roles_make_member
  after insert on public.structure_roles
  for each row execute function private.structure_role_makes_member();

revoke all on function private.ensure_active_org_member(uuid, uuid) from public, anon, authenticated;

-- Rattrapage : les responsables déjà nommés.
select private.ensure_active_org_member(r.organization_id, r.user_id)
from (select distinct organization_id, user_id from public.organization_roles) r;

select private.ensure_active_org_member(s.organization_id, sr.user_id)
from (select distinct structure_id, user_id from public.structure_roles) sr
join public.org_structures s on s.id = sr.structure_id;
