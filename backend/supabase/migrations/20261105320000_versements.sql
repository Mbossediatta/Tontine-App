-- Paiement par versements : le membre paie son tour quand il veut, en une ou plusieurs fois
-- (ex. 100 FCFA par jour sur un tour de 7 jours, ou 3 jours d'un coup, ou tout le reste).
-- Il est « payé » quand la somme de ses versements atteint le total du tour (cotisation de
-- toutes ses parts sur toute la durée du tour, plus ses pénalités) ; « en retard » seulement
-- si ce total n'est pas atteint à la date limite du tour (plus le délai de grâce).
-- Les frais d'adhésion partent avec le premier versement ; une pénalité, avec celui qui
-- termine le tour.

-- Cotisation minimale : celle des Paramètres (100 FCFA au plus bas), plus 500 figés dans la
-- table, qui refusaient un groupe à 100 FCFA même réglé ainsi par le super admin.
alter table public.groups drop constraint groups_contribution_amount_check;
alter table public.groups add constraint groups_contribution_amount_check
  check (contribution_amount >= 100);

-- Plusieurs versements réussis par tour : seul l'essai en cours reste unique.
drop index public.payments_one_active_idx;
create unique index payments_one_pending_idx
  on public.payments (round_id, user_id) where status in ('pending', 'late');

-- Total du tour pour cette personne : cotisation de toutes ses parts sur la durée du tour,
-- plus ses pénalités (hors frais d'adhésion, réglés une fois pour le groupe).
create or replace function private.round_total(p_round uuid, p_user uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select
    g.contribution_amount::bigint * g.turn_length
      * (select count(*) from public.memberships m
         where m.group_id = g.id and m.user_id = p_user and m.status = 'active')
    + coalesce((select sum(pe.amount) from public.penalties pe
                where pe.round_id = r.id and pe.user_id = p_user), 0)
  from public.rounds r join public.groups g on g.id = r.group_id
  where r.id = p_round
$$;

-- Déjà versé sur le tour (cotisation et pénalité des versements réussis).
create or replace function private.round_paid(p_round uuid, p_user uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(p.contribution_amount + p.late_penalty_amount), 0)::bigint
  from public.payments p
  where p.round_id = p_round and p.user_id = p_user and p.status = 'paid'
$$;

-- Payé : la somme des versements atteint le total du tour.
create or replace function private.member_status(p_round uuid, p_user uuid)
returns public.payment_status
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.round_paid(p_round, p_user) >= private.round_total(p_round, p_user)
      and private.round_total(p_round, p_user) > 0 then 'paid'
    when private.is_late(p_round, p_user) then 'late'
    when (select p.status from public.payments p
      where p.round_id = p_round and p.user_id = p_user
      order by p.created_at desc limit 1) = 'failed' then 'failed'
    else 'pending'
  end::public.payment_status
$$;

-- En retard : total du tour pas atteint, et pénalité posée ou date limite + grâce dépassée.
create or replace function private.is_late(p_round uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.round_paid(p_round, p_user) < private.round_total(p_round, p_user)
    and (
      exists (select 1 from public.penalties pe where pe.round_id = p_round and pe.user_id = p_user)
      or (
        select r.due_date + coalesce((s.rules ->> 'graceDays')::integer, 0) + 1
        from public.rounds r, public.platform_settings s where r.id = p_round
      ) <= now()
    )
$$;

-- Ce qui reste à payer sur le tour (relances, montants en retard des tableaux de bord) :
-- reste du tour, plus les frais d'adhésion s'ils ne sont pas encore réglés.
create or replace function private.amount_due(p_round uuid, p_user uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(0, private.round_total(r.id, p_user) - private.round_paid(r.id, p_user))
    + case when exists (
        select 1 from public.platform_earnings e
        where e.group_id = g.id and e.user_id = p_user and e.kind = 'membership_fee'
      ) then 0 else g.membership_fee_amount end
  from public.rounds r join public.groups g on g.id = r.group_id
  where r.id = p_round
$$;

-- Montants d'un versement : `p_periods` périodes du rythme (toutes mes parts), ou tout le
-- reste si null. Renvoie contribution, frais d'adhésion et pénalité de ce versement.
create or replace function private.installment(
  r public.rounds, g public.groups, p_user uuid, p_periods integer
)
returns table (contribution integer, fee integer, penalty integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  shares integer := (select count(*) from public.memberships
    where group_id = g.id and user_id = p_user and status = 'active');
  per_period integer := g.contribution_amount * shares;
  paid_contribution integer := coalesce((select sum(p.contribution_amount) from public.payments p
    where p.round_id = r.id and p.user_id = p_user and p.status = 'paid'), 0);
  paid_penalty integer := coalesce((select sum(p.late_penalty_amount) from public.payments p
    where p.round_id = r.id and p.user_id = p_user and p.status = 'paid'), 0);
  rest integer := greatest(0, per_period * g.turn_length - paid_contribution);
begin
  if p_periods is not null and (p_periods < 1 or p_periods > g.turn_length) then
    raise exception 'Nombre de jours ou de périodes invalide.' using errcode = '22023';
  end if;
  contribution := case when p_periods is null then rest else least(rest, per_period * p_periods) end;
  fee := case when exists (
      select 1 from public.platform_earnings e
      where e.group_id = g.id and e.user_id = p_user and e.kind = 'membership_fee'
    ) then 0 else g.membership_fee_amount end;
  -- La pénalité part avec le versement qui termine le tour.
  penalty := case when contribution >= rest then greatest(0, coalesce((select sum(amount)
    from public.penalties where round_id = r.id and user_id = p_user), 0) - paid_penalty) else 0 end;
  if contribution + fee + penalty <= 0 then
    raise exception 'Vous avez déjà payé ce tour.' using errcode = '23505';
  end if;
  return next;
end;
$$;

-- Paiement en ligne : un versement (`p_periods`) ou tout le reste du tour.
drop function public.svc_payment_prepare(uuid, uuid, public.payment_method);
create function public.svc_payment_prepare(
  p_user uuid, p_round uuid, p_method public.payment_method, p_periods integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.rounds;
  g public.groups;
  part record;
  amount_due integer;
  service_fee integer;
  fee_percent numeric := coalesce(
    (select (s.payment ->> 'feePercent')::numeric from public.platform_settings s), 0);
  pay_mode text := coalesce(
    (select s.payment ->> 'mode' from public.platform_settings s), 'test');
  existing public.payments;
  saved_id uuid;
begin
  if p_method = 'cash' then
    raise exception 'Choisissez Wave, Orange Money ou Free Money.' using errcode = '22023';
  end if;
  select * into r from public.rounds where id = p_round;
  if not found then
    raise exception 'Ce tour n’existe pas.' using errcode = 'P0002';
  end if;
  select * into g from public.groups where id = r.group_id;
  if not exists (select 1 from public.memberships
                 where group_id = g.id and user_id = p_user and status = 'active') then
    raise exception 'Vous ne faites pas partie de ce groupe.' using errcode = '42501';
  end if;
  perform private.assert_group_open(g);
  if r.status <> 'open' then
    raise exception 'Ce tour n’accepte plus de paiement.' using errcode = '22023';
  end if;
  if private.member_status(r.id, p_user) = 'paid' then
    raise exception 'Vous avez déjà payé ce tour.' using errcode = '23505';
  end if;

  select * into part from private.installment(r, g, p_user, p_periods);
  amount_due := part.contribution + part.fee + part.penalty;
  -- Frais payés par le membre : arrondis au franc supérieur (serviceFee, lib/tontine.ts).
  service_fee := ceil(amount_due * fee_percent / 100)::integer;

  select * into existing from public.payments
  where round_id = r.id and user_id = p_user and status in ('pending', 'late')
  for update;
  if found then
    -- Nouvel essai : montants à jour, ancien jeton PayTech abandonné.
    update public.payments
    set amount = amount_due, contribution_amount = part.contribution,
      membership_fee_amount = part.fee, late_penalty_amount = part.penalty,
      service_fee_amount = service_fee, method = p_method,
      status = 'pending', provider_token = null, created_at = now()
    where id = existing.id
    returning id into saved_id;
  else
    insert into public.payments (round_id, user_id, amount, contribution_amount,
      membership_fee_amount, late_penalty_amount, service_fee_amount, method, status)
    values (r.id, p_user, amount_due, part.contribution, part.fee, part.penalty, service_fee,
      p_method, 'pending')
    returning id into saved_id;
  end if;

  return jsonb_build_object(
    'paymentId', saved_id,
    'amount', amount_due,
    'serviceFee', service_fee,
    'total', amount_due + service_fee,
    'groupName', g.name,
    'roundNumber', r.number,
    'mode', pay_mode
  );
end;
$$;

revoke all on function public.svc_payment_prepare(uuid, uuid, public.payment_method, integer)
  from public, anon, authenticated;
grant execute on function public.svc_payment_prepare(uuid, uuid, public.payment_method, integer)
  to service_role;

-- Espèces reçues par un gestionnaire : un versement (`p_periods`) ou tout le reste du tour.
drop function public.payment_record_cash(uuid, uuid);
create function public.payment_record_cash(p_round uuid, p_user uuid, p_periods integer default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.rounds := private.require_round(p_round);
  g public.groups := private.require_group(r.group_id);
  uid uuid := private.require_manage(g);
  part record;
  total integer;
  payment_id uuid;
begin
  perform private.assert_group_open(g);
  if r.status <> 'open' then
    raise exception 'Ce tour n’accepte plus de paiement.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.memberships
                 where group_id = g.id and user_id = p_user and status = 'active') then
    raise exception 'Cette personne n’a pas de part dans le groupe.' using errcode = '22023';
  end if;
  if private.member_status(r.id, p_user) = 'paid' then
    raise exception 'Ce membre a déjà payé.' using errcode = '22023';
  end if;
  select * into part from private.installment(r, g, p_user, p_periods);
  total := part.contribution + part.fee + part.penalty;

  -- Un essai en ligne resté en attente est remplacé par le paiement en espèces.
  update public.payments set status = 'failed'
  where round_id = r.id and user_id = p_user and status in ('pending', 'late');
  insert into public.payments (round_id, user_id, amount, contribution_amount,
    membership_fee_amount, late_penalty_amount, method, status, paid_at, recorded_by)
  values (r.id, p_user, total, part.contribution, part.fee, part.penalty,
    'cash', 'paid', now(), uid)
  returning id into payment_id;
  insert into public.platform_earnings (group_id, kind, amount, payment_id, round_id, user_id)
  select g.id, e.kind::public.earning_kind, e.amount, payment_id, r.id, p_user
  from (values ('membership_fee', part.fee), ('late_penalty', part.penalty)) e(kind, amount)
  where e.amount > 0;

  perform private.audit(uid, 'cash_recorded',
    format('a enregistré %s en espèces de %s — %s',
      private.format_amount(total), private.full_name(p_user), g.name),
    g.id);
  perform private.notify(p_user, 'payment', 'Paiement en espèces enregistré',
    format('%s : %s reçus pour le tour %s.', g.name, private.format_amount(total), r.number),
    '/groupes/' || g.id);
  perform private.notify_managers(g.id, 'payment', 'Paiement reçu',
    format('%s a payé %s en espèces.', private.full_name(p_user), private.format_amount(total)));
  perform private.refresh_round(r.id);
end;
$$;

revoke all on function public.payment_record_cash(uuid, uuid, integer) from public, anon;
grant execute on function public.payment_record_cash(uuid, uuid, integer) to authenticated;

