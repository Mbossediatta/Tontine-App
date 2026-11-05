-- Étape 3 — Règles d'accès (RLS).
-- Référence : tontine-pwa/src/services/mock/access.ts et section 4.2 du cahier d'intégration.
--
-- Principe :
-- - la clé publique (anon) n'accède à aucune table : tout ce qui se fait avant la
--   connexion passe par les Edge Functions (service_role) ;
-- - un compte connecté lit ce qui le concerne ; il n'écrit directement que dans quelques
--   colonnes (son profil, ses notifications lues, ses abonnements push). Toutes les autres
--   écritures passent par des fonctions RPC ou des Edge Functions (étapes suivantes) ;
-- - un compte suspendu ou supprimé ne voit plus rien ;
-- - être admin d'une communauté ne donne aucun droit sur ses groupes.

-- ---------------------------------------------------------------------------
-- Privilèges de base : on part de zéro, puis on ouvre le strict nécessaire.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;

grant select on all tables in schema public to authenticated;

-- Écritures directes autorisées, colonne par colonne.
grant update (first_name, last_name, avatar_url, payout_phone, payout_method, language,
  notification_prefs) on public.profiles to authenticated;
grant update (read) on public.notifications to authenticated;
grant insert (user_id, endpoint, p256dh, auth), delete on public.push_subscriptions
  to authenticated;

-- Les fonctions du schéma privé ne sont pas appelables, sauf les aides listées plus bas.
revoke execute on all functions in schema private from public;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Fonctions d'aide (SECURITY DEFINER : elles lisent sans passer par RLS, ce qui évite
-- les boucles entre politiques). Elles ne renvoient que des booléens ou un identifiant.
-- ---------------------------------------------------------------------------

-- Identifiant du compte connecté s'il est actif (ni suspendu ni supprimé), sinon null.
create or replace function private.active_uid()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.profiles p
  where p.id = auth.uid() and not p.is_suspended and p.deleted_at is null
$$;

create or replace function private.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.global_role = 'super_admin'
      and not p.is_suspended and p.deleted_at is null
  )
$$;

-- Admin responsable, propriétaire ou co-admin actif du groupe, ou super admin.
create or replace function private.can_manage_group(target_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_super_admin() or exists (
    select 1 from public.groups g
    where g.id = target_group
      and private.active_uid() is not null
      and (
        g.admin_id = private.active_uid()
        or exists (
          select 1 from public.memberships m
          where m.group_id = g.id and m.user_id = private.active_uid()
            and m.status = 'active' and m.role in ('owner', 'co_admin')
        )
      )
  )
$$;

-- Peut consulter le groupe : gestionnaire, ou membre actif (au moins une part).
create or replace function private.can_view_group(target_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_manage_group(target_group) or exists (
    select 1 from public.memberships m
    where m.group_id = target_group and m.user_id = private.active_uid() and m.status = 'active'
  )
$$;

-- Le compte connecté gère un groupe où cette personne a une part ou une demande.
create or replace function private.manages_person(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_super_admin() or exists (
    select 1 from public.memberships m
    where m.user_id = target_user and m.status in ('pending', 'active')
      and private.can_manage_group(m.group_id)
  )
$$;

create or replace function private.is_community_admin(target_community uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.community_admins ca
    where ca.community_id = target_community and ca.admin_id = private.active_uid()
  )
$$;

grant execute on function
  private.active_uid(),
  private.is_super_admin(),
  private.can_manage_group(uuid),
  private.can_view_group(uuid),
  private.manages_person(uuid),
  private.is_community_admin(uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- Politiques
-- ---------------------------------------------------------------------------

-- Profils : le sien ; ceux des personnes de ses groupes s'il les gère ; tous pour le
-- super admin. Les autres membres ne voient que nom et photo, via public_profiles().
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select private.active_uid())
    or (select private.is_super_admin())
    or private.manages_person(id)
  );

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select private.active_uid()))
  with check (id = (select private.active_uid()));

create policy communities_select on public.communities
  for select to authenticated
  using (
    (select private.is_super_admin())
    or private.is_community_admin(id)
    or exists (
      select 1 from public.groups g
      where g.community_id = communities.id and private.can_view_group(g.id)
    )
  );

create policy community_admins_select on public.community_admins
  for select to authenticated
  using (
    (select private.is_super_admin())
    or admin_id = (select private.active_uid())
    or private.is_community_admin(community_id)
  );

-- Groupes : ceux qu'on peut consulter, plus ceux où l'on a une demande en attente.
create policy groups_select on public.groups
  for select to authenticated
  using (
    private.can_view_group(id)
    or exists (
      select 1 from public.memberships m
      where m.group_id = groups.id and m.user_id = (select private.active_uid())
        and m.status = 'pending'
    )
  );

-- Adhésions : les siennes ; les parts actives des groupes dont on est membre ; toutes
-- (demandes comprises) pour les gestionnaires.
create policy memberships_select on public.memberships
  for select to authenticated
  using (
    user_id = (select private.active_uid())
    or private.can_manage_group(group_id)
    or (status = 'active' and private.can_view_group(group_id))
  );

create policy rounds_select on public.rounds
  for select to authenticated
  using (private.can_view_group(group_id));

create policy round_beneficiaries_select on public.round_beneficiaries
  for select to authenticated
  using (
    exists (
      select 1 from public.rounds r
      where r.id = round_beneficiaries.round_id and private.can_view_group(r.group_id)
    )
  );

-- Paiements : les siens, ou ceux des groupes qu'on gère. Le statut des autres membres
-- (si member_status_visibility = 'members') sera servi par les vues de l'étape 5.
create policy payments_select on public.payments
  for select to authenticated
  using (
    user_id = (select private.active_uid())
    or exists (
      select 1 from public.rounds r
      where r.id = payments.round_id and private.can_manage_group(r.group_id)
    )
  );

create policy penalties_select on public.penalties
  for select to authenticated
  using (
    user_id = (select private.active_uid())
    or exists (
      select 1 from public.rounds r
      where r.id = penalties.round_id and private.can_manage_group(r.group_id)
    )
  );

create policy platform_earnings_select on public.platform_earnings
  for select to authenticated
  using ((select private.is_super_admin()));

create policy admin_compensations_select on public.admin_compensations
  for select to authenticated
  using ((select private.is_super_admin()) or admin_id = (select private.active_uid()));

create policy swap_requests_select on public.swap_requests
  for select to authenticated
  using (
    requester_id = (select private.active_uid())
    or partner_id = (select private.active_uid())
    or private.can_manage_group(group_id)
  );

create policy notifications_select on public.notifications
  for select to authenticated
  using (user_id = (select private.active_uid()));

create policy notifications_update_self on public.notifications
  for update to authenticated
  using (user_id = (select private.active_uid()))
  with check (user_id = (select private.active_uid()));

create policy push_subscriptions_select on public.push_subscriptions
  for select to authenticated
  using (user_id = (select private.active_uid()));

create policy push_subscriptions_insert on public.push_subscriptions
  for insert to authenticated
  with check (user_id = (select private.active_uid()));

create policy push_subscriptions_delete on public.push_subscriptions
  for delete to authenticated
  using (user_id = (select private.active_uid()));

-- Journal d'audit : tout pour le super admin ; celui de ses groupes pour un gestionnaire.
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (
    (select private.is_super_admin())
    or (group_id is not null and private.can_manage_group(group_id))
  );

create policy security_events_select on public.security_events
  for select to authenticated
  using ((select private.is_super_admin()));

create policy disputes_select on public.disputes
  for select to authenticated
  using ((select private.is_super_admin()) or user_id = (select private.active_uid()));

create policy dispute_events_select on public.dispute_events
  for select to authenticated
  using (
    exists (
      select 1 from public.disputes d
      where d.id = dispute_events.dispute_id
        and ((select private.is_super_admin()) or d.user_id = (select private.active_uid()))
    )
  );

create policy provider_ledger_select on public.provider_ledger
  for select to authenticated
  using ((select private.is_super_admin()));

create policy sms_log_select on public.sms_log
  for select to authenticated
  using ((select private.is_super_admin()));

create policy platform_settings_select on public.platform_settings
  for select to authenticated
  using ((select private.is_super_admin()));

-- ---------------------------------------------------------------------------
-- Lectures publiques limitées
-- ---------------------------------------------------------------------------

-- Nom et photo des personnes qui partagent un groupe avec le compte connecté
-- (membres, demandes visibles par les gestionnaires, admin responsable).
-- Jamais le numéro : il reste réservé aux gestionnaires (politique profiles_select).
create or replace function public.public_profiles(ids uuid[])
returns table (id uuid, first_name text, last_name text, avatar_url text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    case when p.deleted_at is null then p.first_name else 'Compte' end,
    case when p.deleted_at is null then p.last_name else 'supprimé' end,
    case when p.deleted_at is null then p.avatar_url end
  from public.profiles p
  where p.id = any (ids)
    and private.active_uid() is not null
    and (
      p.id = private.active_uid()
      or private.is_super_admin()
      or exists (
        select 1 from public.groups g
        where private.can_view_group(g.id)
          and (
            g.admin_id = p.id
            or exists (
              select 1 from public.memberships m
              where m.group_id = g.id and m.user_id = p.id
                and (m.status = 'active' or (m.status = 'pending' and private.can_manage_group(g.id)))
            )
          )
      )
    )
$$;

-- Paramètres utiles à tous les écrans (frais, limites, textes), sans aucun indice de clé.
create or replace function public.public_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'payment', jsonb_build_object(
      'provider', s.payment -> 'provider',
      'feePercent', s.payment -> 'feePercent',
      'mode', s.payment -> 'mode'
    ),
    'rules', s.rules,
    'security', jsonb_build_object('inactivityLockMinutes', s.security -> 'inactivityLockMinutes'),
    'app', s.app
  )
  from public.platform_settings s
  where private.active_uid() is not null
$$;

revoke execute on function public.public_profiles(uuid[]), public.public_settings()
  from public, anon;
grant execute on function public.public_profiles(uuid[]), public.public_settings()
  to authenticated;
