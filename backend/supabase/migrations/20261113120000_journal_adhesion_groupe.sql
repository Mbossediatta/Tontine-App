-- Journal : une seule ligne quand un membre demande à rejoindre un groupe (ou le rejoint),
-- même s'il prend plusieurs parts ; rien pour le créateur inscrit d'office (propriétaire),
-- dont la création du groupe est déjà tracée. Ajouter des parts à un membre déjà présent
-- n'est pas une nouvelle demande.

drop trigger if exists memberships_audit_insert on public.memberships;
drop function if exists private.audit_membership_insert();

create or replace function private.audit_memberships_inserted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select n.group_id, n.user_id, bool_or(n.status = 'active') as active
    from new_rows n
    where n.user_id = auth.uid() and n.role = 'member'
    group by n.group_id, n.user_id
  loop
    if exists (
      select 1 from public.memberships m
      where m.group_id = r.group_id and m.user_id = r.user_id
        and m.id not in (select n.id from new_rows n)
    ) then
      continue;
    end if;
    perform private.audit(r.user_id, 'join_requested',
      format(case when r.active then 'a rejoint le groupe « %s »'
                  else 'a demandé à rejoindre le groupe « %s »' end,
        (select g.name from public.groups g where g.id = r.group_id)),
      r.group_id);
  end loop;
  return null;
end;
$$;

create trigger memberships_audit_inserted
  after insert on public.memberships
  referencing new table as new_rows
  for each statement execute function private.audit_memberships_inserted();

revoke all on function private.audit_memberships_inserted() from public;
