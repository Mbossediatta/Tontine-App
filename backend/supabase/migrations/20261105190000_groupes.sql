-- Étape 5 — Groupes, adhésions et supervision des groupes par le super admin.
-- Référence : tontine-pwa/src/services/mock/group.mock.ts, membership.mock.ts et la partie
-- « Supervision des groupes » de admin.mock.ts (mêmes règles, mêmes messages).
--
-- Les lectures passent par les tables (RLS) ; toutes les écritures passent par ces
-- fonctions, qui vérifient elles-mêmes les droits de la personne connectée.
-- Démarrage du cycle, tirage de l'ordre et relance d'un cycle : étape 6.

-- ---------------------------------------------------------------------------
-- Aides internes
-- ---------------------------------------------------------------------------

-- Compte connecté actif, sinon erreur « session expirée ».
create or replace function private.require_uid()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := private.active_uid();
begin
  if uid is null then
    raise exception 'Session expirée, reconnectez-vous.' using errcode = '28000';
  end if;
  return uid;
end;
$$;

create or replace function private.require_super_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
begin
  if not private.is_super_admin() then
    raise exception 'Réservé au super administrateur.' using errcode = '42501';
  end if;
  return uid;
end;
$$;

-- Saisie qui ressemble à une attaque (mêmes signatures que mock/security.ts). Le refus porte
-- l'indice « suspicious_input:<champ> » : le frontend trace alors l'événement par
-- log_refusal (une écriture faite ici serait annulée avec l'erreur).
create or replace function private.inspect_input(p_field text, p_value text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null then
    return;
  end if;
  if p_value ~* '<\s*script|<\s*iframe|javascript\s*:|\mon(error|load|click)\s*='
    or p_value ~* '\munion\s+(all\s+)?select\M|\mdrop\s+table\M|\mdelete\s+from\M|\minsert\s+into\M|''\s*or\s+''?\d+''?\s*=\s*''?\d+|;\s*--|/\*.*\*/'
  then
    raise exception 'Ce texte contient des caractères non autorisés.'
      using errcode = '22023', hint = 'suspicious_input:' || p_field;
  end if;
end;
$$;

create or replace function private.notify(
  p_user uuid, p_type text, p_title text, p_body text, p_link text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, type, title, body, link)
  values (p_user, p_type, p_title, p_body, p_link);
$$;

-- Admins de la communauté, admin responsable, propriétaire et co-admins (une fois chacun).
create or replace function private.notify_managers(
  p_group uuid, p_type text, p_title text, p_body text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, type, title, body, link)
  select distinct manager, p_type, p_title, p_body, '/admin/groupes/' || p_group
  from (
    select ca.admin_id as manager
    from public.groups g
    join public.community_admins ca on ca.community_id = g.community_id
    where g.id = p_group
    union
    select g.admin_id from public.groups g where g.id = p_group
    union
    select m.user_id from public.memberships m
    where m.group_id = p_group and m.status = 'active' and m.role in ('owner', 'co_admin')
  ) managers;
$$;

create or replace function private.audit(
  p_actor uuid, p_action public.audit_action, p_summary text, p_group uuid default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (actor_id, action, summary, group_id)
  values (p_actor, p_action, p_summary, p_group);
$$;

create or replace function private.full_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.first_name || ' ' || p.last_name from public.profiles p where p.id = p_user
$$;

create or replace function private.format_amount(p_amount integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(to_char(p_amount, 'FM999G999G999'), ',', ' ') || ' FCFA'
$$;

create or replace function private.require_group(p_group uuid)
returns public.groups
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  g public.groups;
begin
  select * into g from public.groups where id = p_group;
  if not found then
    raise exception 'Ce groupe n’existe pas.' using errcode = 'P0002';
  end if;
  return g;
end;
$$;

-- Gestionnaire du groupe, sinon refus (indice « access_denied:<groupe> », voir log_refusal).
create or replace function private.require_manage(p_group public.groups)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
begin
  if not private.can_manage_group(p_group.id) then
    raise exception 'Seuls les administrateurs du groupe peuvent faire cela.'
      using errcode = '42501', hint = 'access_denied:' || p_group.name;
  end if;
  return uid;
end;
$$;

-- Propriétaire : super admin, admin responsable ou membre « owner ».
create or replace function private.is_owner(p_group public.groups, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_super_admin() or p_group.admin_id = p_user or exists (
    select 1 from public.memberships m
    where m.group_id = p_group.id and m.user_id = p_user and m.status = 'active'
      and m.role = 'owner'
  )
$$;

-- Administrateur actif (rôle admin, ni suspendu ni supprimé).
create or replace function private.is_active_admin(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_user and p.global_role = 'admin'
      and not p.is_suspended and p.deleted_at is null
  )
$$;

create or replace function private.active_share_count(p_group uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.memberships
  where group_id = p_group and status = 'active'
$$;

-- Montant et parts dans les limites fixées par le super admin (Paramètres → Règles).
create or replace function private.check_group_limits(
  p_amount integer, p_max_members integer, p_shares_per_round integer
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  rules jsonb := (select s.rules from public.platform_settings s);
  min_amount integer := (rules ->> 'minContribution')::integer;
  max_amount integer := (rules ->> 'maxContribution')::integer;
  max_shares integer := (rules ->> 'maxMembers')::integer;
begin
  if p_amount is not null and (p_amount < min_amount or p_amount > max_amount) then
    raise exception 'La cotisation doit être comprise entre % et %.',
      private.format_amount(min_amount), private.format_amount(max_amount) using errcode = '22023';
  end if;
  if p_max_members is not null and p_max_members > max_shares then
    raise exception 'Un groupe ne peut pas dépasser % parts.', max_shares using errcode = '22023';
  end if;
  if p_max_members is not null and p_max_members < 2 then
    raise exception 'Un groupe compte au moins 2 parts.' using errcode = '22023';
  end if;
  if p_shares_per_round is not null and p_max_members is not null
    and p_shares_per_round > p_max_members then
    raise exception 'Les parts payées par tour ne peuvent pas dépasser les parts du groupe.'
      using errcode = '22023';
  end if;
end;
$$;

-- Trace au journal de sécurité un refus signalé par son indice (inspect_input,
-- require_manage) : appelé par le frontend juste après l'erreur.
create or replace function public.log_refusal(p_hint text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  kind text := split_part(coalesce(p_hint, ''), ':', 1);
  subject text := left(substr(coalesce(p_hint, ''), char_length(kind) + 2), 60);
begin
  if kind = 'suspicious_input' then
    insert into public.security_events (kind, severity, detail, user_id)
    values ('suspicious_input', 'warning',
      format('Saisie refusée dans « %s » : ressemble à une attaque', subject), uid);
  elsif kind = 'access_denied' then
    insert into public.security_events (kind, severity, detail, user_id)
    values ('access_denied', 'warning',
      format('Action d’administration refusée sur « %s »', subject), uid);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Groupes
-- ---------------------------------------------------------------------------

-- p : champs de CreateGroupInput (src/types/views.ts), en camelCase.
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
    community_id, join_policy, name, description, contribution_amount, daily_contribution,
    turn_duration_days, shares_per_round, membership_fee_amount, reserve_final_turn,
    frequency, max_members, payment_due_day, start_date, attribution_mode, late_penalty,
    status, created_by, admin_id
  ) values (
    target_community,
    coalesce(p ->> 'joinPolicy', 'invite')::public.join_policy,
    clean_name,
    clean_description,
    amount,
    coalesce((p ->> 'dailyContribution')::boolean, true),
    coalesce((p ->> 'turnDurationDays')::integer, 10),
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

-- p : champs de UpdateGroupInput ; une clé absente ne change rien, une clé à null efface
-- la valeur quand c'est permis (description, pénalité de retard).
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
  if p ? 'dailyContribution' then n.daily_contribution := (p ->> 'dailyContribution')::boolean; end if;
  if p ? 'turnDurationDays' then n.turn_duration_days := (p ->> 'turnDurationDays')::integer; end if;
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
    n.contribution_amount, n.frequency, n.max_members, n.daily_contribution,
    n.turn_duration_days, n.shares_per_round, n.membership_fee_amount, n.reserve_final_turn
  ) is distinct from (
    g.contribution_amount, g.frequency, g.max_members, g.daily_contribution,
    g.turn_duration_days, g.shares_per_round, g.membership_fee_amount, g.reserve_final_turn
  ) then
    raise exception 'Les règles financières et le nombre total de parts sont verrouillés après le démarrage.'
      using errcode = '22023';
  end if;
  if n.max_members < private.active_share_count(g.id) then
    raise exception 'Le groupe compte déjà plus de parts que ce nombre.' using errcode = '22023';
  end if;

  update public.groups set
    name = n.name, description = n.description, contribution_amount = n.contribution_amount,
    daily_contribution = n.daily_contribution, turn_duration_days = n.turn_duration_days,
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

create or replace function public.group_remove(p_group uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.groups := private.require_group(p_group);
  uid uuid := private.require_uid();
begin
  if not private.is_owner(g, uid) then
    raise exception 'Seul le propriétaire du groupe peut faire cela.' using errcode = '42501';
  end if;
  if g.status <> 'draft' then
    raise exception 'Seul un groupe en brouillon peut être supprimé.' using errcode = '22023';
  end if;
  if g.current_cycle > 1 or exists (select 1 from public.rounds where group_id = g.id) then
    raise exception 'Ce groupe a un historique de paiements : il ne peut pas être supprimé.'
      using errcode = '22023';
  end if;
  delete from public.groups where id = g.id;
end;
$$;

create or replace function public.group_regenerate_invite(p_group uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.groups := private.require_group(p_group);
  code text;
begin
  perform private.require_manage(g);
  loop
    code := private.random_invite_code();
    exit when not exists (select 1 from public.groups where invite_code = code);
  end loop;
  update public.groups set invite_code = code where id = g.id;
  return code;
end;
$$;

-- Aperçu d'un groupe à partir de son code d'invitation (type JoinPreview, sans le groupe
-- complet : le frontend reçoit les champs utiles à l'écran « Rejoindre »).
create or replace function public.group_join_preview(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  g public.groups;
  shares integer;
begin
  select * into g from public.groups where invite_code = upper(btrim(coalesce(p_code, '')));
  if not found then
    raise exception 'Code d’invitation inconnu.' using errcode = 'P0002';
  end if;
  shares := private.active_share_count(g.id);
  return jsonb_build_object(
    'group', to_jsonb(g),
    'communityName', (select name from public.communities where id = g.community_id),
    'activeMemberCount', (select count(distinct user_id) from public.memberships
      where group_id = g.id and status = 'active'),
    'activeShareCount', shares,
    'placesLeft', greatest(0, g.max_members - shares),
    'adminNames', coalesce((
      select jsonb_agg(distinct private.full_name(m.user_id))
      from public.memberships m
      where m.group_id = g.id and m.status = 'active' and m.role in ('owner', 'co_admin')
    ), '[]'::jsonb),
    'myMembershipStatus', (
      select m.status from public.memberships m
      where m.group_id = g.id and m.user_id = uid and m.status <> 'removed'
      order by (m.status = 'active') desc
      limit 1
    )
  );
end;
$$;

create or replace function private.request_join(g public.groups, uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.memberships (group_id, user_id, role, status)
  values (g.id, uid, 'member', 'pending');
  perform private.notify_managers(g.id, 'join_request', 'Nouvelle demande d’adhésion',
    format('%s souhaite rejoindre %s.', private.full_name(uid), g.name));
end;
$$;

create or replace function private.has_membership(p_group uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships
    where group_id = p_group and user_id = p_user and status <> 'removed'
  )
$$;

create or replace function public.group_request_join(p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  g public.groups;
begin
  select * into g from public.groups where invite_code = upper(btrim(coalesce(p_code, '')));
  if not found then
    raise exception 'Code d’invitation inconnu.' using errcode = 'P0002';
  end if;
  if private.has_membership(g.id, uid) then
    raise exception 'Vous avez déjà rejoint ce groupe.' using errcode = '22023';
  end if;
  if g.status <> 'draft' then
    raise exception 'Ce groupe a déjà démarré.' using errcode = '22023';
  end if;
  if private.active_share_count(g.id) >= g.max_members and not private.is_super_admin() then
    raise exception 'Toutes les parts configurées pour ce groupe sont attribuées.'
      using errcode = '22023';
  end if;
  perform private.request_join(g, uid);
end;
$$;

-- Demande d'adhésion à un groupe ouvert d'une communauté dont on est déjà membre.
create or replace function public.group_request_join_open(p_group uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  g public.groups := private.require_group(p_group);
begin
  if (select global_role from public.profiles where id = uid) <> 'user' then
    raise exception 'La découverte est réservée aux participants.' using errcode = '22023';
  end if;
  if g.join_policy <> 'community' or g.community_id is null then
    raise exception 'Ce groupe est privé : utilisez son code d’invitation.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.memberships m join public.groups mg on mg.id = m.group_id
    where m.user_id = uid and m.status = 'active' and mg.community_id = g.community_id
  ) then
    raise exception 'Ce groupe est réservé aux membres de sa communauté.' using errcode = '42501';
  end if;
  if private.has_membership(g.id, uid) then
    raise exception 'Vous avez déjà rejoint ce groupe.' using errcode = '22023';
  end if;
  if g.status <> 'draft' then
    raise exception 'Ce groupe a déjà démarré et n’accepte plus de membres.' using errcode = '22023';
  end if;
  if private.active_share_count(g.id) >= g.max_members then
    raise exception 'Toutes les parts configurées pour ce groupe sont attribuées.'
      using errcode = '22023';
  end if;
  perform private.request_join(g, uid);
end;
$$;

-- Groupes ouverts des communautés où le participant a déjà une part active.
create or replace function public.groups_discoverable()
returns setof public.groups
language sql
stable
security definer
set search_path = ''
as $$
  select g.*
  from public.groups g
  where (select global_role from public.profiles where id = private.active_uid()) = 'user'
    and g.join_policy = 'community' and g.status = 'draft' and g.archived_at is null
    and g.community_id in (
      select mg.community_id from public.memberships m join public.groups mg on mg.id = m.group_id
      where m.user_id = private.active_uid() and m.status = 'active'
    )
    and not private.has_membership(g.id, private.active_uid())
    and private.active_share_count(g.id) < g.max_members
  order by g.created_at desc
$$;

-- Annonce aux membres actifs (sauf l'auteur) ; renvoie le nombre de destinataires.
create or replace function public.group_announce(p_group uuid, p_message text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.groups := private.require_group(p_group);
  uid uuid := private.require_manage(g);
  text_ text := btrim(coalesce(p_message, ''));
  recipients integer;
begin
  if text_ = '' then
    raise exception 'Écrivez un message avant d’envoyer.' using errcode = '22023';
  end if;
  if char_length(text_) > 1000 then
    raise exception 'Le message ne peut pas dépasser 1000 caractères.' using errcode = '22023';
  end if;
  perform private.inspect_input('Annonce', text_);
  insert into public.notifications (user_id, type, title, body, link)
  select distinct m.user_id, 'announcement', left('Annonce · ' || g.name, 120), text_,
    '/groupes/' || g.id
  from public.memberships m
  where m.group_id = g.id and m.status = 'active' and m.user_id <> uid;
  get diagnostics recipients = row_count;
  return recipients;
end;
$$;

-- ---------------------------------------------------------------------------
-- Adhésions
-- ---------------------------------------------------------------------------

create or replace function private.require_membership(p_membership uuid)
returns public.memberships
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  m public.memberships;
begin
  select * into m from public.memberships where id = p_membership;
  if not found then
    raise exception 'Ce membre n’existe pas.' using errcode = 'P0002';
  end if;
  return m;
end;
$$;

create or replace function private.assert_room(p_group public.groups, p_additional integer)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.active_share_count(p_group.id) + p_additional > p_group.max_members then
    raise exception 'Toutes les parts configurées pour ce groupe sont attribuées.'
      using errcode = '22023';
  end if;
end;
$$;

create or replace function public.membership_accept(p_membership uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.memberships := private.require_membership(p_membership);
  g public.groups := private.require_group(m.group_id);
begin
  perform private.require_manage(g);
  if m.status <> 'pending' then
    raise exception 'Demande déjà traitée.' using errcode = '22023';
  end if;
  perform private.assert_room(g, 1);
  update public.memberships set status = 'active', joined_at = now() where id = m.id;
  perform private.notify(m.user_id, 'join_accepted', 'Demande acceptée',
    format('Bienvenue dans %s !', g.name), '/groupes/' || g.id);
end;
$$;

create or replace function public.membership_reject(p_membership uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.memberships := private.require_membership(p_membership);
  g public.groups := private.require_group(m.group_id);
begin
  perform private.require_manage(g);
  if m.status <> 'pending' then
    raise exception 'Demande déjà traitée.' using errcode = '22023';
  end if;
  update public.memberships set status = 'removed' where id = m.id;
  perform private.notify(m.user_id, 'join_rejected', 'Demande refusée',
    format('%s : demande refusée.', g.name));
end;
$$;

create or replace function public.membership_remove(p_membership uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.memberships := private.require_membership(p_membership);
  g public.groups := private.require_group(m.group_id);
  uid uuid := private.require_manage(g);
begin
  if g.status <> 'draft' then
    raise exception 'Impossible de retirer un membre après le démarrage du cycle.'
      using errcode = '22023';
  end if;
  if m.role = 'owner' then
    raise exception 'Le propriétaire ne peut pas être retiré.' using errcode = '22023';
  end if;
  if m.role = 'co_admin' and not private.is_owner(g, uid) then
    raise exception 'Seul le propriétaire du groupe peut faire cela.' using errcode = '42501';
  end if;
  update public.memberships set status = 'removed', payout_order = null where id = m.id;
end;
$$;

create or replace function public.membership_set_role(p_membership uuid, p_role public.group_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.memberships := private.require_membership(p_membership);
  g public.groups := private.require_group(m.group_id);
  uid uuid := private.require_manage(g);
begin
  if p_role not in ('co_admin', 'member') then
    raise exception 'Rôle invalide.' using errcode = '22023';
  end if;
  if m.role = 'owner' then
    raise exception 'Le rôle du propriétaire est fixe.' using errcode = '22023';
  end if;
  if m.status <> 'active' then
    raise exception 'Ce membre n’est pas actif.' using errcode = '22023';
  end if;
  if p_role = 'member' and not private.is_owner(g, uid) then
    raise exception 'Seul le propriétaire du groupe peut faire cela.' using errcode = '42501';
  end if;
  update public.memberships set role = p_role where id = m.id;
  if p_role = 'co_admin' then
    perform private.notify(m.user_id, 'co_admin', 'Vous êtes co-administrateur',
      format('Vous pouvez maintenant gérer %s.', g.name), '/admin/groupes/' || g.id);
  end if;
end;
$$;

-- Ajoute une personne déjà inscrite avec le nombre de parts demandé (ou des parts en plus).
-- Un numéro sans compte est refusé : la personne s'inscrit par le lien d'invitation.
create or replace function public.membership_add_by_phone(
  p_group uuid, p_phone text, p_share_count integer default 1
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.groups := private.require_group(p_group);
  target uuid;
  already_active boolean;
  pending_id uuid;
  to_create integer;
begin
  perform private.require_manage(g);
  if g.status <> 'draft' then
    raise exception 'Le cycle a déjà démarré.' using errcode = '22023';
  end if;
  if p_share_count is null or p_share_count < 1 or p_share_count > g.max_members then
    raise exception 'Le nombre de parts doit être compris entre 1 et la capacité du groupe.'
      using errcode = '22023';
  end if;
  select id into target from public.profiles
  where phone = regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') and deleted_at is null;
  if target is null then
    raise exception 'Aucun compte avec ce numéro. Partagez le lien d’invitation pour qu’il s’inscrive.'
      using errcode = 'P0002';
  end if;
  already_active := exists (select 1 from public.memberships
    where group_id = g.id and user_id = target and status = 'active');
  select id into pending_id from public.memberships
  where group_id = g.id and user_id = target and status = 'pending';
  to_create := case when already_active then p_share_count
    else greatest(0, p_share_count - case when pending_id is null then 0 else 1 end) end;
  perform private.assert_room(g, to_create + case when pending_id is null then 0 else 1 end);
  if pending_id is not null then
    update public.memberships set status = 'active', joined_at = now() where id = pending_id;
  end if;
  insert into public.memberships (group_id, user_id, role, status)
  select g.id, target, 'member', 'active' from generate_series(1, to_create);
  perform private.notify(target, 'added',
    case when already_active then 'Parts supplémentaires ajoutées' else 'Ajouté à un groupe' end,
    case when already_active
      then format('%s part(s) supplémentaire(s) vous ont été attribuée(s) dans %s.', p_share_count, g.name)
      else format('Vous faites partie de %s avec %s part(s).', g.name, p_share_count) end,
    '/groupes/' || g.id);
  return p_share_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Supervision par le super admin
-- ---------------------------------------------------------------------------

create or replace function public.group_suspend(p_group uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_super_admin();
  g public.groups := private.require_group(p_group);
begin
  if g.status = 'suspended' then
    raise exception 'Ce groupe est déjà suspendu.' using errcode = '22023';
  end if;
  if g.status = 'finished' then
    raise exception 'Ce groupe est déjà clôturé.' using errcode = '22023';
  end if;
  update public.groups set status = 'suspended' where id = g.id;
  perform private.notify_managers(g.id, 'admin', 'Groupe suspendu',
    format('%s est suspendu par l’administration : paiements et versements sont gelés.', g.name));
  perform private.audit(uid, 'group_suspended', format('a suspendu le groupe « %s »', g.name), g.id);
end;
$$;

create or replace function public.group_reactivate(p_group uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_super_admin();
  g public.groups := private.require_group(p_group);
begin
  if g.status <> 'suspended' then
    raise exception 'Ce groupe n’est pas suspendu.' using errcode = '22023';
  end if;
  -- Un groupe qui avait déjà démarré (des tours existent) reprend son cours ; sinon brouillon.
  update public.groups
  set status = case when exists (select 1 from public.rounds where group_id = g.id)
    then 'active' else 'draft' end::public.group_status
  where id = g.id;
  perform private.notify_managers(g.id, 'admin', 'Groupe réactivé',
    format('%s est de nouveau actif.', g.name));
  perform private.audit(uid, 'group_reactivated', format('a réactivé le groupe « %s »', g.name), g.id);
end;
$$;

create or replace function public.group_close(p_group uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_super_admin();
  g public.groups := private.require_group(p_group);
begin
  if g.status = 'finished' then
    raise exception 'Ce groupe est déjà clôturé.' using errcode = '22023';
  end if;
  update public.groups set status = 'finished' where id = g.id;
  perform private.notify_managers(g.id, 'admin', 'Groupe clôturé',
    format('%s a été clôturé par l’administration de la plateforme.', g.name));
  perform private.audit(uid, 'group_closed', format('a clôturé le groupe « %s »', g.name), g.id);
end;
$$;

create or replace function public.group_archive(p_group uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_super_admin();
  g public.groups := private.require_group(p_group);
begin
  if g.status <> 'finished' then
    raise exception 'Seul un groupe terminé ou clôturé peut être archivé.' using errcode = '22023';
  end if;
  update public.groups set archived_at = now() where id = g.id;
  perform private.audit(uid, 'group_archived', format('a archivé le groupe « %s »', g.name), g.id);
end;
$$;

-- L'ancien responsable perd ses droits de gestion (il reste membre s'il cotise).
create or replace function private.demote_manager(p_group uuid, p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.memberships set role = 'member'
  where group_id = p_group and user_id = p_user and role in ('owner', 'co_admin');
$$;

create or replace function public.group_change_admin(p_group uuid, p_admin uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_super_admin();
  g public.groups := private.require_group(p_group);
begin
  if not exists (select 1 from public.profiles where id = p_admin and global_role = 'admin') then
    raise exception 'Ce compte n’est pas administrateur.' using errcode = '42501';
  end if;
  if not private.is_active_admin(p_admin) then
    raise exception 'Cet administrateur est suspendu.' using errcode = '22023';
  end if;
  update public.groups set admin_id = p_admin where id = g.id;
  if g.admin_id <> p_admin then
    perform private.demote_manager(g.id, g.admin_id);
  end if;
  perform private.notify(p_admin, 'admin', 'Nouveau groupe à gérer',
    format('Vous gérez désormais %s.', g.name), '/admin/groupes/' || g.id);
  perform private.audit(uid, 'group_admin_changed',
    format('a confié le groupe « %s » à %s', g.name, private.full_name(p_admin)), g.id);
end;
$$;

create or replace function public.group_transfer(p_group uuid, p_community uuid, p_admin uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_super_admin();
  g public.groups := private.require_group(p_group);
  community_name text;
begin
  select name into community_name from public.communities where id = p_community;
  if community_name is null then
    raise exception 'Choisissez une communauté existante.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_admin and global_role = 'admin') then
    raise exception 'Ce compte n’est pas administrateur.' using errcode = '42501';
  end if;
  if not private.is_active_admin(p_admin) then
    raise exception 'Choisissez un administrateur actif.' using errcode = '22023';
  end if;

  update public.groups set community_id = p_community, admin_id = p_admin where id = g.id;
  if g.admin_id <> p_admin then
    perform private.demote_manager(g.id, g.admin_id);
  end if;
  insert into public.notifications (user_id, type, title, body, link)
  select distinct m.user_id, 'community', 'Communauté du groupe modifiée',
    format('« %s » appartient maintenant à la communauté « %s ».', g.name, community_name),
    '/groupes/' || g.id
  from public.memberships m
  where m.group_id = g.id and m.status = 'active';
  perform private.notify(p_admin, 'admin', 'Groupe transféré',
    format('Vous êtes maintenant responsable de « %s » dans la communauté « %s ».', g.name, community_name),
    '/admin/groupes/' || g.id);
  if g.admin_id <> p_admin then
    perform private.notify(g.admin_id, 'admin', 'Groupe transféré',
      format('La gestion de « %s » a été transférée à %s.', g.name, private.full_name(p_admin)),
      '/admin/mes-groupes');
  end if;
  perform private.audit(uid, 'group_community_changed',
    format('a transféré « %s »%s la communauté « %s » et l’a confié à %s', g.name,
      case when g.community_id is not null then ' vers' else ' dans' end,
      community_name, private.full_name(p_admin)),
    g.id);
end;
$$;

-- Admins actifs à qui confier un groupe (nom seulement) : ouvert aux administrateurs.
create or replace function public.admin_choices()
returns table (id uuid, name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select pr.global_role from public.profiles pr where pr.id = private.require_uid())
    not in ('admin', 'super_admin') then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;
  return query
    select p.id, p.first_name || ' ' || p.last_name
    from public.profiles p
    where p.global_role = 'admin' and not p.is_suspended and p.deleted_at is null
    order by p.first_name, p.last_name;
end;
$$;

-- ---------------------------------------------------------------------------
-- Journaux en ajout seul : la suppression d'un groupe ou d'un compte remet à vide leur
-- référence (on delete set null). C'est la seule modification permise : le texte de
-- l'entrée, qui garde le nom du groupe, reste intact.
-- ---------------------------------------------------------------------------

create or replace function private.forbid_change_except_unlink()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and not exists (
    select 1
    from jsonb_each(to_jsonb(new)) n
    where n.value is distinct from (to_jsonb(old) -> n.key)
      and (n.key not in ('group_id', 'actor_id', 'user_id') or n.value <> 'null'::jsonb)
  ) then
    return new;
  end if;
  raise exception '% est en ajout seul', tg_table_name using errcode = 'insufficient_privilege';
end;
$$;

drop trigger audit_log_append_only on public.audit_log;
create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function private.forbid_change_except_unlink();

drop trigger security_events_append_only on public.security_events;
create trigger security_events_append_only
  before update or delete on public.security_events
  for each row execute function private.forbid_change_except_unlink();

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
    'log_refusal(text)', 'group_create(jsonb)', 'group_update(uuid, jsonb)',
    'group_remove(uuid)', 'group_regenerate_invite(uuid)', 'group_join_preview(text)',
    'group_request_join(text)', 'group_request_join_open(uuid)', 'groups_discoverable()',
    'group_announce(uuid, text)', 'membership_accept(uuid)', 'membership_reject(uuid)',
    'membership_remove(uuid)', 'membership_set_role(uuid, public.group_role)',
    'membership_add_by_phone(uuid, text, integer)', 'group_suspend(uuid)',
    'group_reactivate(uuid)', 'group_close(uuid)', 'group_archive(uuid)',
    'group_change_admin(uuid, uuid)', 'group_transfer(uuid, uuid, uuid)', 'admin_choices()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end;
$grants$;
