-- Statuts de paiement confidentiels : un membre ne voit que le sien (payé, en attente, en
-- retard) ; les administrateurs du groupe voient ceux de tous. Le nombre de parts payées
-- d'un tour reste visible de tous (avancement de la collecte, sans nom).
-- L'ancien réglage member_status_visibility (« visibles de tous les membres ») n'ouvre plus
-- les statuts des autres.

create or replace function public.group_round_statuses(p_groups uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(r.id, jsonb_build_object(
    'paidCount', private.round_paid_shares(r.id),
    'statuses', coalesce((
      select jsonb_object_agg(u.user_id, private.member_status(r.id, u.user_id))
      from (select distinct m.user_id from public.memberships m
            where m.group_id = g.id and m.status = 'active') u
      where private.can_manage_group(g.id) or u.user_id = private.active_uid()
    ), '{}'::jsonb)
  )), '{}'::jsonb)
  from public.rounds r
  join public.groups g on g.id = r.group_id
  where g.id = any (coalesce(p_groups, '{}')) and r.cycle = g.current_cycle
    and r.status <> 'upcoming' and private.can_view_group(g.id)
$$;
