-- Statut de création du PIN des administrateurs, nécessaire au tableau de bord.
-- Ne renvoie jamais l'empreinte du PIN ni ses compteurs d'essais.
create or replace function public.admin_pin_pending(p_users uuid[])
returns table (user_id uuid, pin_pending boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_super_admin() then
    raise exception 'Accès réservé au super administrateur'
      using errcode = '42501';
  end if;

  return query
  select requested.user_id, coalesce(pin.must_reset or pin.pin_hash is null, true)
  from unnest(coalesce(p_users, array[]::uuid[])) as requested(user_id)
  left join private.auth_pins as pin on pin.user_id = requested.user_id;
end;
$$;

revoke all on function public.admin_pin_pending(uuid[]) from public, anon, authenticated;
grant execute on function public.admin_pin_pending(uuid[]) to authenticated;
