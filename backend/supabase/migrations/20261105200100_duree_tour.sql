-- Rythme de cotisation et durée d'un tour, choisis par l'admin du groupe (demande du
-- 2026-11-05) :
-- - frequency : rythme de cotisation (daily, weekly, biweekly, monthly) ;
-- - turn_length : durée d'un tour en périodes de ce rythme (10 jours, 3 semaines, 2 mois…) ;
-- - contribution_amount : cotisation par part et par période. Une part cotise
--   contribution_amount × turn_length par tour.
-- Remplace daily_contribution + turn_duration_days (durée en jours, plafonnée à 90).
-- Référence : tontine-pwa/src/lib/tontine.ts (contributionPerTurn, roundOpenDate, computeDueDate).

alter table public.groups rename column turn_duration_days to turn_length;
alter table public.groups drop constraint groups_turn_duration_days_check;

-- Anciens groupes : journalier → rythme « daily » (même durée) ; sinon un tour = une période.
update public.groups set frequency = 'daily' where daily_contribution;
update public.groups set turn_length = 1 where not daily_contribution;
alter table public.groups drop column daily_contribution;
alter table public.groups alter column turn_length set default 1;

-- Plafonds : un an par tour (365 jours, 52 semaines, 26 quinzaines), deux ans en mensuel.
-- Jour limite : jour du mois en mensuel (1 à 28), de la semaine sinon (1 à 7).
alter table public.groups add constraint groups_turn_length_check check (
  turn_length >= 1 and turn_length <= case frequency
    when 'daily' then 365 when 'weekly' then 52 when 'biweekly' then 26 else 24 end
);
alter table public.groups add constraint groups_payment_due_day_rhythm check (
  frequency in ('daily', 'monthly') or payment_due_day <= 7
);

comment on column public.groups.contribution_amount is
  'Cotisation par part et par période du rythme (frequency), en FCFA.';
comment on column public.groups.turn_length is
  'Durée d''un tour en périodes du rythme : une part cotise contribution_amount × turn_length par tour.';

-- Mêmes règles, avec des messages affichables (appelée par group_create et group_update).
create or replace function private.check_rhythm(
  p_frequency public.frequency, p_turn_length integer, p_due_day integer
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  max_length integer := case p_frequency
    when 'daily' then 365 when 'weekly' then 52 when 'biweekly' then 26 else 24 end;
  unit text := case p_frequency
    when 'daily' then 'jours' when 'weekly' then 'semaines' when 'biweekly' then 'quinzaines'
    else 'mois' end;
begin
  if p_frequency is null then
    raise exception 'Choisissez le rythme de cotisation.' using errcode = '22023';
  end if;
  if p_turn_length is null or p_turn_length < 1 then
    raise exception 'Indiquez la durée d’un tour.' using errcode = '22023';
  end if;
  if p_turn_length > max_length then
    raise exception 'Au plus % % par tour.', max_length, unit using errcode = '22023';
  end if;
  if p_frequency = 'monthly' and (p_due_day < 1 or p_due_day > 28) then
    raise exception 'Choisissez un jour entre 1 et 28.' using errcode = '22023';
  end if;
  if p_frequency in ('weekly', 'biweekly') and (p_due_day < 1 or p_due_day > 7) then
    raise exception 'Choisissez un jour de la semaine.' using errcode = '22023';
  end if;
end;
$$;

revoke execute on function private.check_rhythm(public.frequency, integer, integer) from public;

-- Fonctions qui lisaient daily_contribution / turn_duration_days.

create or replace function private.round_expected(p_round uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case when r.status = 'upcoming' then 0 else
    g.contribution_amount::bigint
      * g.turn_length
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

create or replace function private.amount_due(p_round uuid, p_user uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select
    g.contribution_amount::bigint
      * g.turn_length
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

create or replace function public.group_create(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  me public.profiles;
  by_platform boolean;
  delegated boolean;
  chosen_admin uuid := nullif(p ->> 'adminId', '')::uuid;
  target_admin uuid;
  target_community uuid := nullif(p ->> 'communityId', '')::uuid;
  clean_name text := btrim(coalesce(p ->> 'name', ''));
  clean_description text := nullif(btrim(coalesce(p ->> 'description', '')), '');
  amount integer := (p ->> 'contributionAmount')::integer;
  max_members integer := (p ->> 'maxMembers')::integer;
  shares_per_round integer := coalesce((p ->> 'sharesPerRound')::integer, 1);
  g public.groups;
begin
  select * into me from public.profiles where id = uid;
  if me.global_role not in ('admin', 'super_admin') then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;
  perform private.check_group_limits(amount, max_members, shares_per_round);
  perform private.check_rhythm(
    (p ->> 'frequency')::public.frequency,
    coalesce((p ->> 'turnLength')::integer, 1),
    coalesce((p ->> 'paymentDueDay')::integer, 1));
  perform private.inspect_input('Nom du groupe', clean_name);
  perform private.inspect_input('Description du groupe', clean_description);
  if char_length(clean_name) not between 3 and 50 then
    raise exception 'Le nom du groupe doit contenir entre 3 et 50 caractères.' using errcode = '22023';
  end if;

  -- Super admin : il confie le groupe à un admin et n'y cotise pas. Admin : il gère son
  -- groupe et en est le premier membre (propriétaire), ou le confie à un autre admin.
  by_platform := me.global_role = 'super_admin';
  delegated := not by_platform and chosen_admin is not null and chosen_admin <> uid;
  if by_platform or delegated then
    if not private.is_active_admin(chosen_admin) then
      raise exception 'Choisissez l’administrateur responsable du groupe.' using errcode = '22023';
    end if;
    target_admin := chosen_admin;
  else
    target_admin := uid;
  end if;

  if target_community is null then
    select ca.community_id into target_community
    from public.community_admins ca join public.communities c on c.id = ca.community_id
    where ca.admin_id = target_admin
    order by c.created_at
    limit 1;
  elsif not exists (select 1 from public.communities where id = target_community) then
    target_community := null;
  end if;
  if target_community is null then
    raise exception 'Affectez d’abord votre compte à une communauté.' using errcode = '22023';
  end if;
  -- Un admin ne crée des groupes que dans les communautés qui lui sont affectées.
  if not by_platform and not exists (
    select 1 from public.community_admins
    where community_id = target_community and admin_id = uid
  ) then
    raise exception 'Vous n’êtes pas administrateur de cette communauté.' using errcode = '42501';
  end if;

  insert into public.groups (
    community_id, join_policy, name, description, contribution_amount, turn_length,
    shares_per_round, membership_fee_amount, reserve_final_turn,
    frequency, max_members, payment_due_day, start_date, attribution_mode, late_penalty,
    status, created_by, admin_id
  ) values (
    target_community,
    coalesce(p ->> 'joinPolicy', 'invite')::public.join_policy,
    clean_name,
    clean_description,
    amount,
    coalesce((p ->> 'turnLength')::integer, 1),
    shares_per_round,
    case when coalesce((p ->> 'collectMembershipFee')::boolean, false)
      then coalesce((p ->> 'membershipFeeAmount')::integer, 0) else 0 end,
    coalesce((p ->> 'reserveFinalTurn')::boolean, true),
    (p ->> 'frequency')::public.frequency,
    max_members,
    (p ->> 'paymentDueDay')::integer,
    (p ->> 'startDate')::timestamptz::date,
    coalesce(p ->> 'attributionMode', 'random')::public.attribution_mode,
    (p ->> 'latePenalty')::integer,
    'draft',
    uid,
    target_admin
  ) returning * into g;

  if by_platform or delegated then
    perform private.notify(target_admin, 'admin', 'Nouveau groupe à gérer',
      format('%s vous a confié « %s ».',
        case when by_platform then 'Le super administrateur' else private.full_name(uid) end,
        g.name),
      '/admin/groupes/' || g.id);
  else
    -- Le créateur est propriétaire et participe à la tontine.
    insert into public.memberships (group_id, user_id, role, status)
    values (g.id, uid, 'owner', 'active');
  end if;
  perform private.audit(uid, 'group_created', format('a créé le groupe « %s »', g.name), g.id);
  return g.id;
end;
$$;

create or replace function public.group_update(p_group uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.groups := private.require_group(p_group);
  uid uuid := private.require_manage(g);
  n public.groups := g;
  amount_changed boolean;
begin
  if p ? 'name' then n.name := btrim(coalesce(p ->> 'name', '')); end if;
  if p ? 'description' then n.description := nullif(btrim(coalesce(p ->> 'description', '')), ''); end if;
  if p ? 'contributionAmount' then n.contribution_amount := (p ->> 'contributionAmount')::integer; end if;
  if p ? 'turnLength' then n.turn_length := (p ->> 'turnLength')::integer; end if;
  if p ? 'sharesPerRound' then n.shares_per_round := (p ->> 'sharesPerRound')::integer; end if;
  if p ? 'reserveFinalTurn' then n.reserve_final_turn := (p ->> 'reserveFinalTurn')::boolean; end if;
  if p ? 'frequency' then n.frequency := (p ->> 'frequency')::public.frequency; end if;
  if p ? 'maxMembers' then n.max_members := (p ->> 'maxMembers')::integer; end if;
  if p ? 'paymentDueDay' then n.payment_due_day := (p ->> 'paymentDueDay')::integer; end if;
  if p ? 'startDate' then n.start_date := (p ->> 'startDate')::timestamptz::date; end if;
  if p ? 'attributionMode' then n.attribution_mode := (p ->> 'attributionMode')::public.attribution_mode; end if;
  if p ? 'latePenalty' then n.late_penalty := (p ->> 'latePenalty')::integer; end if;
  if p ? 'joinPolicy' then n.join_policy := (p ->> 'joinPolicy')::public.join_policy; end if;
  if p ? 'memberStatusVisibility' then
    n.member_status_visibility := (p ->> 'memberStatusVisibility')::public.status_visibility;
  end if;
  if p ? 'collectMembershipFee' then
    n.membership_fee_amount := case when (p ->> 'collectMembershipFee')::boolean
      then coalesce((p ->> 'membershipFeeAmount')::integer, g.membership_fee_amount, 0) else 0 end;
  elsif p ? 'membershipFeeAmount' then
    n.membership_fee_amount := coalesce((p ->> 'membershipFeeAmount')::integer, 0);
  end if;

  perform private.check_group_limits(
    case when p ? 'contributionAmount' then n.contribution_amount end,
    case when p ? 'maxMembers' then n.max_members end,
    null);
  perform private.check_rhythm(n.frequency, n.turn_length, n.payment_due_day);
  perform private.inspect_input('Nom du groupe', n.name);
  perform private.inspect_input('Description du groupe', n.description);
  if char_length(n.name) not between 3 and 50 then
    raise exception 'Le nom du groupe doit contenir entre 3 et 50 caractères.' using errcode = '22023';
  end if;
  if n.shares_per_round > n.max_members then
    raise exception 'Les parts payées par tour ne peuvent pas dépasser les parts du groupe.'
      using errcode = '22023';
  end if;
  if g.status <> 'draft' and (
    n.contribution_amount, n.frequency, n.max_members, n.turn_length, n.shares_per_round, n.membership_fee_amount, n.reserve_final_turn
  ) is distinct from (
    g.contribution_amount, g.frequency, g.max_members, g.turn_length, g.shares_per_round, g.membership_fee_amount, g.reserve_final_turn
  ) then
    raise exception 'Les règles financières et le nombre total de parts sont verrouillés après le démarrage.'
      using errcode = '22023';
  end if;
  if n.max_members < private.active_share_count(g.id) then
    raise exception 'Le groupe compte déjà plus de parts que ce nombre.' using errcode = '22023';
  end if;

  update public.groups set
    name = n.name, description = n.description, contribution_amount = n.contribution_amount,
    turn_length = n.turn_length,
    shares_per_round = n.shares_per_round, membership_fee_amount = n.membership_fee_amount,
    reserve_final_turn = n.reserve_final_turn, frequency = n.frequency,
    max_members = n.max_members, payment_due_day = n.payment_due_day,
    start_date = n.start_date, attribution_mode = n.attribution_mode,
    late_penalty = n.late_penalty, join_policy = n.join_policy,
    member_status_visibility = n.member_status_visibility
  where id = g.id;

  -- Le journal garde la trace du changement de montant, le plus sensible.
  amount_changed := n.contribution_amount <> g.contribution_amount;
  perform private.audit(uid, 'group_updated',
    case when amount_changed
      then format('a modifié le montant de cotisation de « %s » (%s)', n.name,
        private.format_amount(n.contribution_amount))
      else format('a modifié les réglages de « %s »', n.name) end,
    g.id);
end;
$$;
