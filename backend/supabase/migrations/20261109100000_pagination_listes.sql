-- Pagination côté serveur des longues listes du super admin : Transactions, Journal
-- d'audit, Sécurité. L'écran reçoit 50 lignes à la fois (« Voir plus » demande les
-- suivantes) au lieu de tout l'historique ; filtres, recherche et totaux sont calculés ici.
--
-- Pagination par curseur : la page suivante commence après (date, id) de la dernière ligne
-- reçue. Contrairement à un numéro de page, une ligne ajoutée entre-temps ne décale rien.
-- Les totaux (summary) ne sont renvoyés qu'avec la première page.

create extension if not exists unaccent with schema extensions;

-- Texte comparable pour la recherche : minuscules, sans accents (« Fatou Diop » ↔ « fatou »).
create or replace function private.searchable(p_text text)
returns text
language sql
stable
set search_path = ''
as $$
  select lower(extensions.unaccent(coalesce(p_text, '')));
$$;

-- Motif « contient » pour LIKE, la saisie étant prise à la lettre (% et _ échappés).
create or replace function private.contains_pattern(p_search text)
returns text
language sql
stable
set search_path = ''
as $$
  select '%' || replace(replace(replace(private.searchable(trim(p_search)), '\', '\\'), '%', '\%'), '_', '\_') || '%';
$$;

-- Nom affiché d'un compte (comme le frontend) ; null si le compte n'existe pas.
create or replace function private.display_name(p public.profiles)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p.id is null then null
    when p.deleted_at is not null then 'Compte supprimé'
    else p.first_name || ' ' || p.last_name
  end;
$$;

-- Taille d'une page : 50 par défaut, 1 à 1000 (les exports lisent par pages de 1000).
create or replace function private.page_size(p_limit integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select least(greatest(coalesce(p_limit, 50), 1), 1000);
$$;

-- --- Transactions -----------------------------------------------------------------

create or replace function public.transactions_page(
  p_status public.payment_status default null,
  p_method public.payment_method default null,
  p_group uuid default null,
  p_from date default null,
  p_to date default null,
  p_cursor_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := private.page_size(p_limit);
begin
  perform private.require_super_admin();
  return (
    with filtered as (
      select p.*, r.group_id, r.number as round_number, g.name as group_name
      from public.payments p
      join public.rounds r on r.id = p.round_id
      join public.groups g on g.id = r.group_id
      where (p_status is null or p.status = p_status)
        and (p_method is null or p.method = p_method)
        and (p_group is null or r.group_id = p_group)
        and (p_from is null or p.created_at >= p_from::timestamptz)
        and (p_to is null or p.created_at < (p_to + 1)::timestamptz)
    ),
    page as (
      select f.*, row_number() over (order by f.created_at desc, f.id desc) as rn
      from filtered f
      where p_cursor_at is null or (f.created_at, f.id) < (p_cursor_at, p_cursor_id)
      order by f.created_at desc, f.id desc
      limit v_limit + 1
    )
    select jsonb_build_object(
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', pg.id,
          'round_id', pg.round_id,
          'user_id', pg.user_id,
          'amount', pg.amount,
          'contribution_amount', pg.contribution_amount,
          'membership_fee_amount', pg.membership_fee_amount,
          'late_penalty_amount', pg.late_penalty_amount,
          'service_fee_amount', pg.service_fee_amount,
          'method', pg.method,
          'provider_ref', pg.provider_ref,
          'status', pg.status,
          'paid_at', pg.paid_at,
          'created_at', pg.created_at,
          'group_id', pg.group_id,
          'group_name', pg.group_name,
          'round_number', pg.round_number,
          'user', jsonb_build_object(
            'id', u.id,
            'first_name', u.first_name,
            'last_name', u.last_name,
            'phone', u.phone,
            'avatar_url', u.avatar_url,
            'payout_phone', u.payout_phone,
            'payout_method', u.payout_method,
            'deleted_at', u.deleted_at
          )
        ) order by pg.rn)
        from page pg
        join public.profiles u on u.id = pg.user_id
        where pg.rn <= v_limit
      ), '[]'::jsonb),
      'hasMore', (select count(*) > v_limit from page),
      'summary', case when p_cursor_at is null then (
        select jsonb_build_object(
          'total', count(*),
          'paidAmount', coalesce(sum(amount) filter (where status = 'paid'), 0),
          'openCount', count(*) filter (where status in ('pending', 'failed'))
        )
        from filtered
      ) end
    )
  );
end;
$$;

-- --- Journal d'audit --------------------------------------------------------------

create or replace function public.audit_page(
  p_search text default null,
  p_actor uuid default null,
  p_actions public.audit_action[] default null,
  p_from date default null,
  p_to date default null,
  p_cursor_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := private.page_size(p_limit);
  v_pattern text := case when nullif(trim(p_search), '') is null then null
                         else private.contains_pattern(p_search) end;
begin
  perform private.require_super_admin();
  return (
    with filtered as (
      select a.*, coalesce(private.display_name(pr), 'Compte supprimé') as actor_name
      from public.audit_log a
      left join public.profiles pr on pr.id = a.actor_id
      where (p_actor is null or a.actor_id = p_actor)
        and (p_actions is null or a.action = any (p_actions))
        and (p_from is null or a.at >= p_from::timestamptz)
        and (p_to is null or a.at < (p_to + 1)::timestamptz)
        and (v_pattern is null or private.searchable(
          coalesce(private.display_name(pr), 'Compte supprimé') || ' ' || a.summary
        ) like v_pattern)
    ),
    page as (
      select f.*, row_number() over (order by f.at desc, f.id desc) as rn
      from filtered f
      where p_cursor_at is null or (f.at, f.id) < (p_cursor_at, p_cursor_id)
      order by f.at desc, f.id desc
      limit v_limit + 1
    )
    select jsonb_build_object(
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', pg.id,
          'actor_id', pg.actor_id,
          'action', pg.action,
          'summary', pg.summary,
          'group_id', pg.group_id,
          'at', pg.at,
          'actor_name', pg.actor_name
        ) order by pg.rn)
        from page pg
        where pg.rn <= v_limit
      ), '[]'::jsonb),
      'hasMore', (select count(*) > v_limit from page),
      'summary', case when p_cursor_at is null then jsonb_build_object(
        'total', (select count(*) from filtered),
        'actors', (select count(distinct actor_id) from filtered),
        'today', (select count(*) from public.audit_log where at >= current_date::timestamptz)
      ) end
    )
  );
end;
$$;

-- Auteurs présents dans le journal (liste du filtre « Auteur »), par ordre alphabétique.
create or replace function public.audit_actors()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_super_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', private.display_name(p))
                     order by private.display_name(p))
    from public.profiles p
    where exists (select 1 from public.audit_log a where a.actor_id = p.id)
  ), '[]'::jsonb);
end;
$$;

-- --- Sécurité ---------------------------------------------------------------------

create or replace function public.security_page(
  p_kinds public.security_event_kind[] default null,
  p_severity public.security_severity default null,
  p_search text default null,
  p_cursor_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := private.page_size(p_limit);
  v_pattern text := case when nullif(trim(p_search), '') is null then null
                         else private.contains_pattern(p_search) end;
begin
  perform private.require_super_admin();
  return (
    with filtered as (
      select e.id, e.kind, e.severity, e.detail, e.user_id, e.phone, e.at,
             private.display_name(pr) as user_name
      from public.security_events e
      left join public.profiles pr on pr.id = e.user_id
      where (p_kinds is null or e.kind = any (p_kinds))
        and (p_severity is null or e.severity = p_severity)
        and (v_pattern is null or private.searchable(
          coalesce(private.display_name(pr), '') || ' ' || coalesce(e.phone, '') || ' ' || e.detail
        ) like v_pattern)
    ),
    page as (
      select f.*, row_number() over (order by f.at desc, f.id desc) as rn
      from filtered f
      where p_cursor_at is null or (f.at, f.id) < (p_cursor_at, p_cursor_id)
      order by f.at desc, f.id desc
      limit v_limit + 1
    )
    select jsonb_build_object(
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', pg.id,
          'kind', pg.kind,
          'severity', pg.severity,
          'detail', pg.detail,
          'user_id', pg.user_id,
          'phone', pg.phone,
          'at', pg.at,
          'user_name', pg.user_name
        ) order by pg.rn)
        from page pg
        where pg.rn <= v_limit
      ), '[]'::jsonb),
      'hasMore', (select count(*) > v_limit from page),
      'summary', case when p_cursor_at is null then jsonb_build_object(
        'total', (select count(*) from filtered)
      ) end
    )
  );
end;
$$;

-- Compteurs de la rubrique Sécurité (indépendants des filtres) : 7 derniers jours par
-- type, alertes critiques des dernières 24 h, et nombre d'événements par filtre.
create or replace function public.security_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_super_admin();
  return (
    select jsonb_build_object(
      'lastWeek', coalesce((
        select jsonb_object_agg(kind, n)
        from (
          select kind, count(*) as n
          from public.security_events
          where at >= now() - interval '7 days'
          group by kind
        ) k
      ), '{}'::jsonb),
      'criticalToday', (
        select count(*) from public.security_events
        where severity = 'critical' and at >= now() - interval '24 hours'
      ),
      'all', count(*),
      'critical', count(*) filter (where severity = 'critical'),
      'login', count(*) filter (where kind in ('pin_failed', 'pin_blocked', 'otp_failed', 'admin_login')),
      'access', count(*) filter (where kind = 'access_denied'),
      'input', count(*) filter (where kind = 'suspicious_input')
    )
    from public.security_events
  );
end;
$$;

revoke all on function public.transactions_page(public.payment_status, public.payment_method, uuid, date, date, timestamptz, uuid, integer) from public, anon;
revoke all on function public.audit_page(text, uuid, public.audit_action[], date, date, timestamptz, uuid, integer) from public, anon;
revoke all on function public.audit_actors() from public, anon;
revoke all on function public.security_page(public.security_event_kind[], public.security_severity, text, timestamptz, uuid, integer) from public, anon;
revoke all on function public.security_summary() from public, anon;
grant execute on function public.transactions_page(public.payment_status, public.payment_method, uuid, date, date, timestamptz, uuid, integer) to authenticated;
grant execute on function public.audit_page(text, uuid, public.audit_action[], date, date, timestamptz, uuid, integer) to authenticated;
grant execute on function public.audit_actors() to authenticated;
grant execute on function public.security_page(public.security_event_kind[], public.security_severity, text, timestamptz, uuid, integer) to authenticated;
grant execute on function public.security_summary() to authenticated;

-- Tri des transactions par date de création (pagination) sans parcourir toute la table.
create index if not exists payments_created_idx on public.payments (created_at desc, id desc);
