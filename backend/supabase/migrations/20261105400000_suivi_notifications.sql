-- Suivi des messages (Notifications et annonces) : en plus des SMS, le super admin voit
-- combien de notifications ont été envoyées dans l'application (et en push), par type, sur
-- la période choisie. Des totaux seulement : le contenu des notifications reste privé.

create or replace function public.notification_stats(p_days integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_super_admin();
  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'La période doit être comprise entre 1 et 365 jours.' using errcode = '22023';
  end if;
  return (
    with recent as (
      select case when n.type like 'swap%' then 'swap' else n.type end as type
      from public.notifications n
      where n.created_at >= now() - make_interval(days => p_days)
    )
    select jsonb_build_object(
      'count', (select count(*) from recent),
      'byType', coalesce((
        select jsonb_agg(jsonb_build_object('type', type, 'count', n) order by n desc)
        from (select type, count(*) as n from recent group by type) t
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.notification_stats(integer) from public, anon;
grant execute on function public.notification_stats(integer) to authenticated;
