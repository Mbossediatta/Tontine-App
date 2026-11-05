-- Promotion d'un compte existant ou création du profil d'un nouvel administrateur.
-- Appelable uniquement par l'Edge Function admin-create via service_role.
create or replace function public.svc_admin_create(
  p_actor uuid,
  p_user uuid,
  p_phone text,
  p_first_name text,
  p_last_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.profiles;
begin
  if not exists (
    select 1 from public.profiles
    where id = p_actor and global_role = 'super_admin'
      and not is_suspended and deleted_at is null
  ) then
    raise exception 'Action réservée au super administrateur' using errcode = '42501';
  end if;

  select * into target
  from public.profiles
  where phone = p_phone
  for update;

  if found then
    if target.id <> p_user then
      raise exception 'Ce numéro est déjà utilisé par un autre compte' using errcode = '23505';
    end if;
    if target.deleted_at is not null then
      raise exception 'Ce numéro appartient à un compte supprimé' using errcode = '23505';
    end if;
    if target.is_suspended then
      raise exception 'Ce compte est bloqué' using errcode = '42501';
    end if;
    if target.global_role <> 'user' then
      raise exception 'Cette personne est déjà administrateur' using errcode = '23505';
    end if;

    update public.profiles set global_role = 'admin' where id = target.id;
  else
    insert into public.profiles (id, first_name, last_name, phone, global_role)
    values (p_user, p_first_name, p_last_name, p_phone, 'admin')
    returning * into target;
  end if;

  insert into public.audit_log (actor_id, action, summary)
  values (
    p_actor,
    'admin_added',
    format('a nommé %s %s administrateur', target.first_name, target.last_name)
  );
  return target.id;
end;
$$;

revoke all on function public.svc_admin_create(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.svc_admin_create(uuid, uuid, text, text, text) to service_role;
