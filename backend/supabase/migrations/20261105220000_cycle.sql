-- Étape 6 — Cycle : ordre des bénéficiaires, démarrage, tours, paiements en espèces,
-- versement d'une cagnotte, tour réservé au super admin, nouveau cycle.
-- Référence : tontine-pwa/src/services/mock/round.mock.ts, lifecycle.ts (createRounds,
-- refreshRound, closeRound), payment.mock.ts (recordCash) et group.mock.ts (start,
-- restartCycle). Calendrier : tontine-pwa/src/lib/tontine.ts (roundOpenDate, computeDueDate).
-- Paiement en ligne PayTech, rappels SMS, pénalités automatiques et échanges : étapes suivantes.

-- ---------------------------------------------------------------------------
-- Calendrier (mêmes règles que lib/tontine.ts)
-- ---------------------------------------------------------------------------

-- `p_count` périodes du rythme après `p_start`.
create or replace function private.add_periods(
  p_start date, p_frequency public.frequency, p_count integer
)
returns date
language sql
immutable
set search_path = ''
as $$
  select case p_frequency
    when 'daily' then p_start + p_count
    when 'weekly' then p_start + 7 * p_count
    when 'biweekly' then p_start + 14 * p_count
    else (p_start + make_interval(months => p_count))::date
  end
$$;

-- Date limite d'un tour, dans sa dernière période : dernier jour (journalier), jour du mois
-- (mensuel, 1 à 28) ou jour de la semaine (1 = lundi … 7 = dimanche).
create or replace function private.round_due_date(
  p_open date, p_frequency public.frequency, p_due_day integer, p_turn_length integer
)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  last_period date := private.add_periods(p_open, p_frequency, greatest(1, p_turn_length) - 1);
  same_month date;
begin
  if p_frequency = 'daily' then
    return last_period;
  end if;
  if p_frequency = 'monthly' then
    same_month := make_date(extract(year from last_period)::integer,
      extract(month from last_period)::integer, p_due_day);
    return case when same_month < last_period
      then (same_month + interval '1 month')::date else same_month end;
  end if;
  return last_period + ((p_due_day - extract(isodow from last_period)::integer + 7) % 7);
end;
$$;

-- ---------------------------------------------------------------------------
-- Statuts de paiement (une seule règle, servie au frontend par group_round_statuses)
-- ---------------------------------------------------------------------------

-- Statut d'une personne pour un tour : payé l'emporte ; en retard (pénalité, ou date
-- limite + délai de grâce dépassée) ; échec du dernier essai ; sinon en attente.
create or replace function private.member_status(p_round uuid, p_user uuid)
returns public.payment_status
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.payments p
      where p.round_id = p_round and p.user_id = p_user and p.status = 'paid') then 'paid'
    when private.is_late(p_round, p_user) then 'late'
    when (select p.status from public.payments p
      where p.round_id = p_round and p.user_id = p_user
      order by p.created_at desc limit 1) = 'failed' then 'failed'
    else 'pending'
  end::public.payment_status
$$;

-- Parts dont la personne a payé le tour (une personne paie pour toutes ses parts).
create or replace function private.round_paid_shares(p_round uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.rounds r
  join public.memberships m on m.group_id = r.group_id and m.status = 'active'
  where r.id = p_round and private.member_status(r.id, m.user_id) = 'paid'
$$;

-- Statuts des tours du cycle en cours de ces groupes, pour le frontend :
-- { "<round>": { "paidCount": n, "statuses": { "<user>": "paid" | … } } }.
-- Le nombre de parts payées est visible de tous les membres ; le statut de chacun l'est
-- des gestionnaires, de la personne elle-même, et de tous si le groupe le permet.
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
      where private.can_manage_group(g.id)
        or u.user_id = private.active_uid()
        or g.member_status_visibility = 'members'
    ), '{}'::jsonb)
  )), '{}'::jsonb)
  from public.rounds r
  join public.groups g on g.id = r.group_id
  where g.id = any (coalesce(p_groups, '{}')) and r.cycle = g.current_cycle
    and r.status <> 'upcoming' and private.can_view_group(g.id)
$$;

-- ---------------------------------------------------------------------------
-- Ordre des bénéficiaires
-- ---------------------------------------------------------------------------

create or replace function private.require_order_editable(p_group uuid)
returns public.groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.groups := private.require_group(p_group);
begin
  perform private.require_manage(g);
  if g.status <> 'draft' then
    raise exception 'L’ordre ne peut plus être modifié après le démarrage.' using errcode = '22023';
  end if;
  return g;
end;
$$;

-- Tirage au sort de l'ordre (une place par part) ; chacun est prévenu de son tour.
create or replace function public.order_draw(p_group uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.groups := private.require_order_editable(p_group);
begin
  if private.active_share_count(g.id) = 0 then
    raise exception 'Ajoutez d’abord des membres au groupe.' using errcode = '22023';
  end if;
  update public.memberships set payout_order = null where group_id = g.id;
  update public.memberships m set payout_order = drawn.place
  from (
    select id, row_number() over (order by random())::integer as place
    from public.memberships where group_id = g.id and status = 'active'
  ) drawn
  where m.id = drawn.id;
  insert into public.notifications (user_id, type, title, body, link)
  select m.user_id, 'draw', 'Tirage au sort effectué',
    format('%s : vous recevrez la cagnotte au tour %s.', g.name,
      ceil(m.payout_order::numeric / g.shares_per_round)),
    '/groupes/' || g.id
  from public.memberships m
  where m.group_id = g.id and m.status = 'active';
end;
$$;

-- Ordre manuel : chaque part active exactement une fois, dans l'ordre donné.
create or replace function public.order_set(p_group uuid, p_memberships uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.groups := private.require_order_editable(p_group);
begin
  if cardinality(coalesce(p_memberships, '{}')) <> private.active_share_count(g.id)
    or (select count(distinct x) from unnest(p_memberships) x) <> cardinality(p_memberships)
    or exists (
      select 1 from unnest(p_memberships) x
      where not exists (select 1 from public.memberships m
        where m.id = x and m.group_id = g.id and m.status = 'active')
    )
  then
    raise exception 'L’ordre doit contenir chaque membre une seule fois.' using errcode = '22023';
  end if;
  update public.memberships set payout_order = null where group_id = g.id;
  update public.memberships m set payout_order = o.place
  from unnest(p_memberships) with ordinality as o(id, place)
  where m.id = o.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Démarrage : création des tours du cycle
-- ---------------------------------------------------------------------------

-- Un tour par lot de shares_per_round parts (dans l'ordre), plus le tour réservé au super
-- admin si le groupe le prévoit. Cagnotte d'un tour : cotisation d'un tour × parts actives.
create or replace function private.create_rounds(g public.groups)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  shares integer := private.active_share_count(g.id);
  batches integer := ceil(shares::numeric / greatest(1, g.shares_per_round))::integer;
  total integer := batches + case when g.reserve_final_turn then 1 else 0 end;
  pot integer := g.contribution_amount * g.turn_length * shares;
  n integer;
  open_d date;
  new_round uuid;
begin
  for n in 1..total loop
    open_d := private.add_periods(g.start_date, g.frequency, (n - 1) * g.turn_length);
    insert into public.rounds (group_id, cycle, number, open_date, due_date, recipient_type,
      pot_amount, status)
    values (g.id, g.current_cycle, n, open_d,
      private.round_due_date(open_d, g.frequency, g.payment_due_day, g.turn_length),
      case when n > batches then 'platform' else 'members' end::public.recipient_type,
      pot,
      case when n = 1 then 'open' else 'upcoming' end::public.round_status)
    returning id into new_round;
    if n <= batches then
      insert into public.round_beneficiaries (round_id, membership_id)
      select new_round, m.id from public.memberships m
      where m.group_id = g.id and m.status = 'active'
        and m.payout_order > (n - 1) * g.shares_per_round
        and m.payout_order <= n * g.shares_per_round;
    end if;
  end loop;
end;
$$;

create or replace function public.group_start(p_group uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.groups := private.require_group(p_group);
  uid uuid := private.require_manage(g);
begin
  if g.status <> 'draft' then
    raise exception 'Le cycle a déjà démarré.' using errcode = '22023';
  end if;
  if (select count(distinct user_id) from public.memberships
      where group_id = g.id and status = 'active') < 2 then
    raise exception 'Un groupe doit avoir au moins deux personnes distinctes.' using errcode = '22023';
  end if;
  if private.active_share_count(g.id) <> g.max_members then
    raise exception 'Toutes les parts doivent être attribuées avant de démarrer le groupe.'
      using errcode = '22023';
  end if;
  if exists (select 1 from public.memberships
      where group_id = g.id and status = 'active' and payout_order is null) then
    raise exception 'Fixez d’abord l’ordre des bénéficiaires.' using errcode = '22023';
  end if;
  if g.start_date < current_date then
    raise exception 'La date de démarrage est passée : choisissez-en une nouvelle dans les réglages.'
      using errcode = '22023';
  end if;
  update public.groups set status = 'active' where id = g.id;
  perform private.create_rounds(g);
  insert into public.notifications (user_id, type, title, body, link)
  select distinct m.user_id, 'started', 'La tontine démarre',
    format('%s a démarré : première cotisation avant le %s.', g.name,
      to_char((select due_date from public.rounds
        where group_id = g.id and cycle = g.current_cycle and number = 1), 'DD/MM/YYYY')),
    '/groupes/' || g.id
  from public.memberships m
  where m.group_id = g.id and m.status = 'active';
  perform private.audit(uid, 'group_updated', format('a démarré le groupe « %s »', g.name), g.id);
end;
$$;

-- Nouveau cycle d'un groupe terminé : mêmes membres, en brouillon, ordre gardé ou à refaire.
create or replace function public.group_restart_cycle(
  p_group uuid, p_start_date date, p_keep_order boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.groups := private.require_group(p_group);
  uid uuid := private.require_manage(g);
begin
  if g.status <> 'finished' or g.archived_at is not null then
    raise exception 'Seul un groupe terminé peut repartir pour un nouveau cycle.' using errcode = '22023';
  end if;
  if p_start_date is null or p_start_date < current_date then
    raise exception 'Date de démarrage invalide.' using errcode = '22023';
  end if;
  update public.groups
  set current_cycle = current_cycle + 1, status = 'draft', start_date = p_start_date
  where id = g.id;
  if not coalesce(p_keep_order, false) then
    update public.memberships set payout_order = null where group_id = g.id;
  end if;
  insert into public.notifications (user_id, type, title, body, link)
  select distinct m.user_id, 'new_cycle', 'Nouveau cycle',
    format('%s repart pour un cycle %s.', g.name, g.current_cycle + 1), '/groupes/' || g.id
  from public.memberships m
  where m.group_id = g.id and m.status = 'active';
  perform private.audit(uid, 'group_updated',
    format('a relancé « %s » pour un cycle %s', g.name, g.current_cycle + 1), g.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Tours : passage « prêt à verser », versement, tour suivant
-- ---------------------------------------------------------------------------

create or replace function private.assert_group_open(g public.groups)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if g.status = 'suspended' then
    raise exception 'Ce groupe est suspendu par l’administration de la plateforme.'
      using errcode = '22023';
  end if;
  if g.status = 'finished' then
    raise exception 'Ce groupe est clôturé.' using errcode = '22023';
  end if;
end;
$$;

-- Tour ouvert dont toutes les parts sont payées : prêt pour le versement.
create or replace function private.refresh_round(p_round uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.rounds;
  g public.groups;
begin
  select * into r from public.rounds where id = p_round;
  if r.status <> 'open'
    or private.round_paid_shares(r.id) < private.active_share_count(r.group_id)
    or private.active_share_count(r.group_id) = 0 then
    return;
  end if;
  select * into g from public.groups where id = r.group_id;
  update public.rounds set status = 'ready_for_payout' where id = r.id;
  if r.recipient_type = 'platform' then
    insert into public.notifications (user_id, type, title, body, link)
    select p.id, 'platform_income_ready', 'Revenu plateforme prêt',
      format('%s : toutes les cotisations de la période réservée sont reçues.', g.name),
      '/admin/versements'
    from public.profiles p
    where p.global_role = 'super_admin' and not p.is_suspended and p.deleted_at is null;
  end if;
  perform private.notify_managers(g.id, 'ready_for_payout', 'Tour prêt pour le reversement',
    format('%s : tous les membres ont payé le tour %s.', g.name, r.number));
end;
$$;

create or replace function private.require_round(p_round uuid)
returns public.rounds
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.rounds;
begin
  select * into r from public.rounds where id = p_round;
  if not found then
    raise exception 'Ce tour n’existe pas.' using errcode = 'P0002';
  end if;
  return r;
end;
$$;

-- Paiement en espèces reçu par un gestionnaire : cotisation de toutes les parts, frais
-- d'adhésion s'ils restent dus, pénalité éventuelle (frais et pénalité : revenus plateforme).
create or replace function public.payment_record_cash(p_round uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.rounds := private.require_round(p_round);
  g public.groups := private.require_group(r.group_id);
  uid uuid := private.require_manage(g);
  shares integer;
  contribution integer;
  fee integer;
  penalty integer;
  payment_id uuid;
begin
  perform private.assert_group_open(g);
  if r.status <> 'open' then
    raise exception 'Ce tour n’accepte plus de paiement.' using errcode = '22023';
  end if;
  select count(*) into shares from public.memberships
  where group_id = g.id and user_id = p_user and status = 'active';
  if shares = 0 then
    raise exception 'Cette personne n’a pas de part dans le groupe.' using errcode = '22023';
  end if;
  if private.member_status(r.id, p_user) = 'paid' then
    raise exception 'Ce membre a déjà payé.' using errcode = '22023';
  end if;
  contribution := g.contribution_amount * g.turn_length * shares;
  fee := case when exists (
      select 1 from public.platform_earnings e
      where e.group_id = g.id and e.user_id = p_user and e.kind = 'membership_fee'
    ) then 0 else g.membership_fee_amount end;
  penalty := coalesce((select sum(amount) from public.penalties
    where round_id = r.id and user_id = p_user), 0);

  -- Un essai en ligne resté en attente est remplacé par le paiement en espèces.
  update public.payments set status = 'failed'
  where round_id = r.id and user_id = p_user and status in ('pending', 'late');
  insert into public.payments (round_id, user_id, amount, contribution_amount,
    membership_fee_amount, late_penalty_amount, method, status, paid_at, recorded_by)
  values (r.id, p_user, contribution + fee + penalty, contribution, fee, penalty,
    'cash', 'paid', now(), uid)
  returning id into payment_id;
  insert into public.platform_earnings (group_id, kind, amount, payment_id, round_id, user_id)
  select g.id, e.kind::public.earning_kind, e.amount, payment_id, r.id, p_user
  from (values ('membership_fee', fee), ('late_penalty', penalty)) e(kind, amount)
  where e.amount > 0;

  perform private.audit(uid, 'cash_recorded',
    format('a enregistré %s en espèces de %s — %s',
      private.format_amount(contribution + fee + penalty), private.full_name(p_user), g.name),
    g.id);
  perform private.notify(p_user, 'payment', 'Paiement en espèces enregistré',
    format('%s : %s reçus pour le tour %s.', g.name,
      private.format_amount(contribution + fee + penalty), r.number),
    '/groupes/' || g.id);
  perform private.notify_managers(g.id, 'payment', 'Paiement reçu',
    format('%s a payé %s en espèces.', private.full_name(p_user),
      private.format_amount(contribution + fee + penalty)));
  perform private.refresh_round(r.id);
end;
$$;

-- Versement validé par un gestionnaire (super admin pour le tour réservé) : la cagnotte est
-- partagée entre les parts bénéficiaires, puis le tour suivant s'ouvre (ou le cycle finit).
-- Le transfert d'argent lui-même (PayTech ou manuel) est l'étape « Versements ».
create or replace function public.round_payout(p_round uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.rounds := private.require_round(p_round);
  g public.groups := private.require_group(r.group_id);
  uid uuid := private.require_manage(g);
  recipients integer;
  share integer;
  next_round public.rounds;
begin
  if r.recipient_type = 'platform' and not private.is_super_admin() then
    raise exception 'Réservé au super administrateur.' using errcode = '42501';
  end if;
  perform private.assert_group_open(g);
  if r.payout_blocked_at is not null then
    raise exception 'Versement bloqué par l’administration de la plateforme : %.',
      coalesce(r.payout_block_reason, 'vérification en cours') using errcode = '22023';
  end if;
  if r.status = 'paid_out' then
    raise exception 'Cette cagnotte a déjà été reversée.' using errcode = '22023';
  end if;
  if r.status = 'upcoming'
    or private.round_paid_shares(r.id) < private.active_share_count(g.id) then
    raise exception 'Tous les membres doivent avoir payé avant le reversement.' using errcode = '22023';
  end if;
  if r.recipient_type = 'members' and exists (
    select 1 from public.round_beneficiaries b
    join public.memberships m on m.id = b.membership_id
    join public.profiles p on p.id = m.user_id
    where b.round_id = r.id and p.payout_phone is null
  ) then
    raise exception 'Un bénéficiaire n’a pas renseigné de numéro de reversement.' using errcode = '22023';
  end if;

  update public.rounds
  set status = 'paid_out', paid_out_at = now(), payout_validated_by = uid
  where id = r.id;

  if r.recipient_type = 'platform' then
    insert into public.platform_earnings (group_id, kind, amount, round_id)
    select g.id, 'reserved_turn', sum(p.contribution_amount), r.id
    from public.payments p
    where p.round_id = r.id and p.status = 'paid'
    having sum(p.contribution_amount) > 0;
  else
    -- Partage à l'unité près : les premières parts (dans l'ordre) reçoivent le reste.
    select count(*) into recipients from public.round_beneficiaries where round_id = r.id;
    share := r.pot_amount / greatest(1, recipients);
    update public.round_beneficiaries b
    set amount = share + case when ranked.place <= r.pot_amount - share * recipients then 1 else 0 end
    from (
      select b2.membership_id, row_number() over (order by m.payout_order) as place
      from public.round_beneficiaries b2 join public.memberships m on m.id = b2.membership_id
      where b2.round_id = r.id
    ) ranked
    where b.round_id = r.id and b.membership_id = ranked.membership_id;
    insert into public.notifications (user_id, type, title, body, link)
    select m.user_id, 'payout', 'Cagnotte reçue',
      format('Vous avez reçu %s de %s.', private.format_amount(sum(b.amount)::integer), g.name),
      '/groupes/' || g.id
    from public.round_beneficiaries b join public.memberships m on m.id = b.membership_id
    where b.round_id = r.id
    group by m.user_id;
  end if;

  perform private.audit(uid, 'payout_validated',
    format('a validé le versement du tour %s — %s', r.number, g.name), g.id);

  select * into next_round from public.rounds
  where group_id = g.id and cycle = r.cycle and number = r.number + 1;
  if not found then
    update public.groups set status = 'finished' where id = g.id;
    perform private.notify_managers(g.id, 'cycle_finished', 'Cycle terminé',
      format('%s : tous les membres ont reçu la cagnotte. Vous pouvez relancer un nouveau cycle.', g.name));
    return;
  end if;
  update public.rounds set status = 'open' where id = next_round.id;
  insert into public.notifications (user_id, type, title, body, link)
  select distinct m.user_id, 'beneficiary', 'Nouveau tour ouvert',
    format('%s : votre part est bénéficiaire au tour %s.', g.name, next_round.number),
    '/groupes/' || g.id
  from public.round_beneficiaries b join public.memberships m on m.id = b.membership_id
  where b.round_id = next_round.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Droits d'exécution
-- ---------------------------------------------------------------------------

revoke execute on all functions in schema private from public;
grant execute on function
  private.active_uid(), private.is_super_admin(), private.can_manage_group(uuid),
  private.can_view_group(uuid), private.manages_person(uuid), private.is_community_admin(uuid)
to authenticated;

do $grants$
declare
  fn text;
begin
  foreach fn in array array[
    'group_round_statuses(uuid[])', 'order_draw(uuid)', 'order_set(uuid, uuid[])',
    'group_start(uuid)', 'group_restart_cycle(uuid, date, boolean)',
    'payment_record_cash(uuid, uuid)', 'round_payout(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end;
$grants$;
