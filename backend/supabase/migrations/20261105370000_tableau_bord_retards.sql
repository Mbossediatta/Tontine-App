-- Tableau de bord du super admin : retards, pénalités, dettes, cagnottes à envoyer et
-- réclamations, calculés par le serveur avec les mêmes règles que le reste (versements,
-- heure limite, délai de grâce).

create or replace function public.platform_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  month_start timestamptz :=
    date_trunc('month', now() at time zone 'Africa/Dakar') at time zone 'Africa/Dakar';
  result jsonb;
begin
  perform private.require_super_admin();
  with current_rounds as (
    select r.id as round_id, g.id as group_id, g.name
    from public.rounds r join public.groups g on g.id = r.group_id
    where g.status = 'active' and r.status in ('open', 'ready_for_payout')
  ),
  late as (
    select c.group_id, c.name, u.user_id, private.amount_due(c.round_id, u.user_id) as owed
    from current_rounds c
    join (select distinct group_id, user_id from public.memberships where status = 'active') u
      on u.group_id = c.group_id
    where private.member_status(c.round_id, u.user_id) = 'late'
  ),
  transfers as (
    select distinct b.round_id, m.user_id, b.sent_at, b.received_at
    from public.round_beneficiaries b
    join public.rounds r on r.id = b.round_id
    join public.memberships m on m.id = b.membership_id
    where r.status = 'paid_out' and r.recipient_type = 'members'
  )
  select jsonb_build_object(
    'lateMembers', (select count(*) from late),
    'lateAmount', coalesce((select sum(owed) from late), 0),
    'lateByGroup', coalesce((
      select jsonb_agg(jsonb_build_object('groupId', group_id, 'name', name, 'count', n))
      from (select group_id, name, count(*) as n from late group by group_id, name) x
    ), '[]'::jsonb),
    'penaltiesThisMonth', coalesce((
      select sum(amount) from public.penalties where applied_at >= month_start), 0),
    'penaltyCountThisMonth', (
      select count(*) from public.penalties where applied_at >= month_start),
    'openDebts', (select count(*) from public.debts where status = 'open'),
    'openDebtAmount', coalesce((
      select sum(amount + penalty_amount) from public.debts where status = 'open'), 0),
    'transfersToSend', (select count(*) from transfers where sent_at is null),
    'transfersAwaiting', (
      select count(*) from transfers where sent_at is not null and received_at is null),
    'openDisputes', (
      select count(*) from public.disputes where status in ('open', 'in_progress'))
  ) into result;
  return result;
end;
$$;

revoke all on function public.platform_health() from public, anon;
grant execute on function public.platform_health() to authenticated;
