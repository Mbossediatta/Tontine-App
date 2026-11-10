-- Appli d'une organisation : les notifications de gestion ne se mélangent plus avec celles
-- du militant.
--
-- - notifications.audience : « member » (sa situation : adhésion, reçus, rappels) ou
--   « manager » (sa gestion : nomination, demandes d'adhésion, paiements reçus). Une
--   notification d'organisation est de gestion quand elle mène à l'administration ou à la
--   page d'une structure (/espace/<adresse>/admin…, /espace/<adresse>/structures/…).
-- - Nouvelle demande d'adhésion : les responsables et gestionnaires des membres de la
--   structure sont prévenus (à défaut, l'administration générale).

alter table public.notifications
  add column audience text not null default 'member' check (audience in ('member', 'manager'));

create or replace function private.notification_app()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.type = 'organization' or new.link like '/espace/%' then
    new.app := 'org';
    if new.link ~ '^/espace/[a-z0-9-]+/(admin|structures)(/|$)' then
      new.audience := 'manager';
    end if;
  end if;
  return new;
end;
$$;

update public.notifications
set audience = 'manager'
where app = 'org' and link ~ '^/espace/[a-z0-9-]+/(admin|structures)(/|$)';

-- Prévient ceux qui gèrent une structure (responsables, gestionnaires des membres ou
-- trésoriers selon p_roles) ; personne : l'administration générale de l'organisation.
create or replace function private.notify_structure_managers(
  p_structure uuid,
  p_roles public.structure_role[],
  p_body text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.org_structures := private.require_structure(p_structure);
  o public.organizations := private.require_organization(s.organization_id);
  target uuid;
  found_one boolean := false;
begin
  for target in
    select distinct r.user_id from public.structure_roles r
    where r.structure_id = s.id and r.role = any (p_roles)
  loop
    found_one := true;
    perform private.notify(target, 'organization', private.structure_label(s.id), p_body,
      '/espace/' || o.slug || '/structures/' || s.id);
  end loop;
  if not found_one then
    for target in
      select r.user_id from public.organization_roles r
      where r.organization_id = o.id and r.role = 'org_admin'
    loop
      perform private.notify(target, 'organization', private.structure_label(s.id), p_body,
        '/espace/' || o.slug || '/structures/' || s.id);
    end loop;
  end if;
end;
$$;

create or replace function private.structure_request_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'pending' then
    perform private.notify_structure_managers(new.structure_id,
      array['responsable', 'gestionnaire_membres']::public.structure_role[],
      format('Nouvelle demande d’adhésion de %s, à valider.', private.full_name(new.user_id)));
  end if;
  return null;
end;
$$;

create trigger structure_members_request_notify
  after insert on public.structure_members
  for each row execute function private.structure_request_notify();

revoke all on function private.notify_structure_managers(uuid, public.structure_role[], text)
  from public, anon, authenticated;
