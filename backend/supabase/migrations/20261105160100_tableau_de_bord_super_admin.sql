-- Tableau de bord du super administrateur : admin_super_dashboard().
-- Même calcul que la simulation (tontine-pwa/src/services/mock/admin.mock.ts, superDashboard,
-- et metrics.ts) ; renvoie exactement le type SuperAdminDashboard (src/types/views.ts).

-- ---------------------------------------------------------------------------
-- Indicateurs d'un tour (metrics.ts)
-- ---------------------------------------------------------------------------

-- Attendu : cotisations des parts actives, frais d'adhésion non encore payés, pénalités.
-- Un tour à venir n'attend rien.
create or replace function private.round_expected(p_round uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case when r.status = 'upcoming' then 0 else
    g.contribution_amount::bigint
      * (case when g.daily_contribution then g.turn_duration_days else 1 end)
      * (select count(*) from public.memberships m where m.group_id = g.id and m.status = 'active')
    + g.membership_fee_amount::bigint * (
        select count(distinct m.user_id) from public.memberships m
        where m.group_id = g.id and m.status = 'active'
          and not exists (
            select 1 from public.platform_earnings e
            where e.group_id = g.id and e.user_id = m.user_id and e.kind = 'membership_fee'
          )
      )
    + coalesce((select sum(pe.amount) from public.penalties pe where pe.round_id = r.id), 0)
  end
  from public.rounds r join public.groups g on g.id = r.group_id
  where r.id = p_round
$$;

-- Encaissé : paiements réussis (frais d'adhésion et pénalités compris, frais PayTech exclus).
create or replace function private.round_collected(p_round uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(amount), 0) from public.payments where round_id = p_round and status = 'paid'
$$;

-- Montant dû par une personne pour toutes ses parts d'un tour (amountBreakdown).
create or replace function private.amount_due(p_round uuid, p_user uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select
    g.contribution_amount::bigint
      * (case when g.daily_contribution then g.turn_duration_days else 1 end)
      * (select count(*) from public.memberships m
         where m.group_id = g.id and m.user_id = p_user and m.status = 'active')
    + coalesce((select sum(pe.amount) from public.penalties pe
                where pe.round_id = r.id and pe.user_id = p_user), 0)
    + case when exists (
        select 1 from public.platform_earnings e
        where e.group_id = g.id and e.user_id = p_user and e.kind = 'membership_fee'
      ) then 0 else g.membership_fee_amount end
  from public.rounds r join public.groups g on g.id = r.group_id
  where r.id = p_round
$$;

-- Personne en retard sur un tour : pas de paiement réussi, et pénalité appliquée ou date
-- limite + délai de grâce dépassée (memberStatus = 'late').
create or replace function private.is_late(p_round uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
      select 1 from public.payments p
      where p.round_id = p_round and p.user_id = p_user and p.status = 'paid'
    )
    and (
      exists (select 1 from public.penalties pe where pe.round_id = p_round and pe.user_id = p_user)
      or (
        select r.due_date + coalesce((s.rules ->> 'graceDays')::integer, 0) + 1
        from public.rounds r, public.platform_settings s where r.id = p_round
      ) <= now()
    )
$$;

-- Tour en cours d'un groupe (ouvert ou prêt à verser).
create or replace function private.current_round(p_group uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select r.id from public.rounds r
  join public.groups g on g.id = r.group_id
  where r.group_id = p_group and r.cycle = g.current_cycle
    and r.status in ('open', 'ready_for_payout')
  order by r.number
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- Formats JSON du frontend
-- ---------------------------------------------------------------------------

create or replace function private.user_json(p public.profiles)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', p.id, 'firstName', p.first_name, 'lastName', p.last_name, 'phone', coalesce(p.phone, ''),
    'avatarUrl', p.avatar_url, 'globalRole', p.global_role, 'isSuspended', p.is_suspended,
    'payoutPhone', p.payout_phone, 'payoutMethod', p.payout_method, 'deletedAt', p.deleted_at,
    'createdAt', p.created_at
  ))
$$;

-- PublicUser avec numéro (réservé aux gestionnaires) ; compte supprimé anonymisé.
create or replace function private.public_user_json(p public.profiles)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case when p.deleted_at is not null
    then jsonb_build_object('id', p.id, 'firstName', 'Compte', 'lastName', 'supprimé')
    else jsonb_strip_nulls(jsonb_build_object(
      'id', p.id, 'firstName', p.first_name, 'lastName', p.last_name, 'avatarUrl', p.avatar_url,
      'phone', p.phone, 'payoutPhone', p.payout_phone, 'payoutMethod', p.payout_method
    ))
  end
$$;

create or replace function private.payment_json(p public.payments)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', p.id, 'roundId', p.round_id, 'userId', p.user_id, 'amount', p.amount,
    'contributionAmount', p.contribution_amount, 'membershipFeeAmount', p.membership_fee_amount,
    'latePenaltyAmount', p.late_penalty_amount, 'serviceFeeAmount', p.service_fee_amount,
    'method', p.method, 'providerRef', p.provider_ref, 'status', p.status,
    'paidAt', p.paid_at, 'createdAt', p.created_at
  ))
$$;

-- « 2 membres », « 1 demande »
create or replace function private.plural(n bigint, singular text, plural_form text default null)
returns text
language sql
immutable
set search_path = ''
as $$
  select n || ' ' || case when n > 1 then coalesce(plural_form, singular || 's') else singular end
$$;

-- ---------------------------------------------------------------------------
-- Tableau de bord
-- ---------------------------------------------------------------------------

create or replace function public.admin_super_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  due_count bigint;
  on_time_count bigint;
  late_amount bigint := 0;
  alerts jsonb := '[]'::jsonb;
  failed_today bigint;
  g record;
  late_users bigint;
  late_sum bigint;
  current uuid;
  monthly jsonb;
begin
  if not private.is_super_admin() then
    raise exception 'Action réservée au super administrateur.' using errcode = '42501';
  end if;

  -- Ponctualité : une cotisation par part active et par tour ouvert ou passé.
  select
    count(*) filter (where paid.paid_at is not null or r.due_date < current_date),
    count(*) filter (where paid.paid_at is not null and paid.paid_at::date <= r.due_date)
  into due_count, on_time_count
  from public.rounds r
  join public.memberships m on m.group_id = r.group_id and m.status = 'active'
  left join lateral (
    select min(p.paid_at) as paid_at from public.payments p
    where p.round_id = r.id and p.user_id = m.user_id and p.status = 'paid'
  ) paid on true
  where r.status <> 'upcoming';

  -- Alertes : échecs du jour, retards par groupe actif, demandes en attente.
  select count(*) into failed_today from public.payments
  where status = 'failed' and created_at::date = current_date;
  if failed_today > 0 then
    alerts := alerts || jsonb_build_object(
      'id', 'failed-today', 'tone', 'danger',
      'title', private.plural(failed_today, 'paiement échoué', 'paiements échoués') || ' aujourd’hui',
      'detail', 'Vérifier avec le service de paiement');
  end if;

  for g in
    select gr.id, gr.name, coalesce(a.first_name || ' ' || a.last_name, '—') as admin_name
    from public.groups gr left join public.profiles a on a.id = gr.admin_id
    where gr.status = 'active' order by gr.created_at, gr.name
  loop
    current := private.current_round(g.id);
    if current is null then continue; end if;
    select count(*), coalesce(sum(private.amount_due(current, u.user_id)), 0)
    into late_users, late_sum
    from (select distinct user_id from public.memberships
          where group_id = g.id and status = 'active') u
    where private.is_late(current, u.user_id);
    late_amount := late_amount + late_sum;
    if late_users > 0 then
      alerts := alerts || jsonb_build_object(
        'id', 'late-' || g.id, 'tone', 'warning',
        'title', g.name || ' : ' || private.plural(late_users, 'membre') || ' en retard',
        'detail', 'Admin : ' || g.admin_name,
        'link', '/admin/groupes/' || g.id);
    end if;
  end loop;

  select alerts || coalesce(jsonb_agg(jsonb_build_object(
      'id', 'join-' || x.id, 'tone', 'info',
      'title', private.plural(x.requests, 'demande', 'demandes') || ' d’adhésion en attente',
      'detail', x.name || ' · Admin : ' || x.admin_name,
      'link', '/admin/groupes/' || x.id) order by x.created_at, x.name), '[]'::jsonb)
  into alerts
  from (
    select gr.id, gr.name, gr.created_at, coalesce(a.first_name || ' ' || a.last_name, '—') as admin_name,
      (select count(*) from public.memberships m where m.group_id = gr.id and m.status = 'pending') as requests
    from public.groups gr left join public.profiles a on a.id = gr.admin_id
  ) x
  where x.requests > 0;

  -- Six derniers mois (le mois en cours en dernier), tours rangés au mois de leur échéance.
  select jsonb_agg(jsonb_build_object(
      'month', to_char(m.month, 'YYYY-MM-DD"T"00:00:00.000"Z"'),
      'expected', coalesce(t.expected, 0), 'collected', coalesce(t.collected, 0)) order by m.month)
  into monthly
  from generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') m(month)
  left join lateral (
    select sum(private.round_expected(r.id)) as expected, sum(private.round_collected(r.id)) as collected
    from public.rounds r where date_trunc('month', r.due_date) = m.month
  ) t on true;

  return jsonb_build_object(
    'groups', (
      select jsonb_build_object(
        'total', count(*),
        'active', count(*) filter (where status = 'active'),
        'suspended', count(*) filter (where status = 'suspended'),
        'finished', count(*) filter (where status = 'finished'),
        'draft', count(*) filter (where status = 'draft'))
      from public.groups),
    'members', (
      select count(*) from public.profiles where global_role = 'user' and deleted_at is null),
    'newMembersThisMonth', (
      select count(*) from public.profiles
      where global_role = 'user' and deleted_at is null
        and date_trunc('month', created_at) = date_trunc('month', now())),
    'collectedThisMonth', monthly -> -1 -> 'collected',
    'expectedThisMonth', monthly -> -1 -> 'expected',
    'onTimeRate', case when due_count > 0 then round(on_time_count * 100.0 / due_count) end,
    'lateAmount', late_amount,
    'monthly', monthly,
    'alerts', alerts,
    'admins', coalesce((
      select jsonb_agg(jsonb_build_object(
          'user', private.user_json(a),
          'groups', coalesce((
            select jsonb_agg(jsonb_build_object('id', gr.id, 'name', gr.name, 'status', gr.status)
                             order by gr.created_at, gr.name)
            from public.groups gr where gr.id = any (managed.ids)), '[]'::jsonb),
          'memberCount', (
            select count(distinct m.user_id) from public.memberships m
            where m.group_id = any (managed.ids) and m.status = 'active' and m.user_id <> a.id),
          'recoveryRate', (
            select case when sum(private.round_expected(r.id)) > 0
              then least(100, round(sum(private.round_collected(r.id)) * 100.0
                                    / sum(private.round_expected(r.id)))) end
            from public.rounds r
            where r.group_id = any (managed.ids) and r.status <> 'upcoming' and r.due_date < current_date),
          'pinPending', not exists (
            select 1 from private.auth_pins ap
            where ap.user_id = a.id and ap.pin_hash is not null and not ap.must_reset)
        ) order by a.created_at, a.last_name)
      from public.profiles a
      cross join lateral (
        select coalesce(array_agg(gr.id), '{}') as ids from public.groups gr
        where gr.admin_id = a.id or exists (
          select 1 from public.memberships m
          where m.group_id = gr.id and m.user_id = a.id and m.status = 'active'
            and m.role in ('owner', 'co_admin'))
      ) managed
      where a.global_role = 'admin' and a.deleted_at is null), '[]'::jsonb),
    'transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
          'payment', private.payment_json(p), 'user', private.public_user_json(u),
          'groupId', gr.id, 'groupName', gr.name, 'roundNumber', r.number)
        order by coalesce(p.created_at, p.paid_at) desc)
      from (select * from public.payments order by coalesce(created_at, paid_at) desc limit 5) p
      join public.rounds r on r.id = p.round_id
      join public.groups gr on gr.id = r.group_id
      join public.profiles u on u.id = p.user_id), '[]'::jsonb),
    'audit', coalesce((
      select jsonb_agg(jsonb_build_object(
          'entry', jsonb_strip_nulls(jsonb_build_object(
            'id', l.id, 'actorId', l.actor_id, 'action', l.action, 'summary', l.summary,
            'groupId', l.group_id, 'at', l.at)),
          'actorName', coalesce(case when u.deleted_at is null then u.first_name || ' ' || u.last_name end,
                                'Compte supprimé'))
        order by l.at desc)
      from (select * from public.audit_log order by at desc limit 5) l
      left join public.profiles u on u.id = l.actor_id), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.admin_super_dashboard() from public, anon;
grant execute on function public.admin_super_dashboard() to authenticated;

-- Fonctions internes : appelées seulement par les fonctions SECURITY DEFINER ci-dessus.
revoke execute on function
  private.round_expected(uuid), private.round_collected(uuid), private.amount_due(uuid, uuid),
  private.is_late(uuid, uuid), private.current_round(uuid), private.user_json(public.profiles),
  private.public_user_json(public.profiles), private.payment_json(public.payments),
  private.plural(bigint, text, text)
from public, anon, authenticated;
