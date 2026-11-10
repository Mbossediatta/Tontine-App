-- 1. Ajout direct d'un militant par l'administration (cahier § 2.2 et § 5.1), sans lien
--    d'invitation : utile pour ceux qui n'ont pas de smartphone ou pour reprendre les
--    anciens membres. Appelé par l'Edge Function afp-member-add (qui crée le compte si le
--    numéro est nouveau). L'adhésion est validée tout de suite (numéro de membre attribué).
-- 2. Tableau de bord de l'administration et liste de toutes les caisses.

-- Le compte p_actor gère-t-il la structure ? (sans session : appel des Edge Functions)
create or replace function private.actor_manages_structure(p_actor uuid, p_structure uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_actor and not p.is_suspended and p.deleted_at is null
  ) and (
    exists (
      select 1 from public.org_structures s
      join public.organization_roles r
        on r.organization_id = s.organization_id and r.user_id = p_actor and r.role = 'org_admin'
      where s.id = p_structure
    )
    or exists (
      select 1 from public.structure_roles r
      where r.user_id = p_actor
        and r.structure_id in (select a.id from private.structure_ancestors(p_structure) a)
    )
  )
$$;

create or replace function public.svc_org_member_add(
  p_actor uuid,
  p_structure uuid,
  p_user uuid,
  p_is_new boolean,
  p_phone text,
  p_first_name text,
  p_last_name text,
  p_region text,
  p_departement text,
  p_commune text,
  p_localite text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.org_structures := private.require_structure(p_structure);
  o public.organizations := private.require_organization(s.organization_id);
  om public.organization_members;
  existing public.structure_members;
  clean_region text := nullif(btrim(coalesce(p_region, '')), '');
  clean_departement text := nullif(btrim(coalesce(p_departement, '')), '');
  clean_commune text := nullif(btrim(coalesce(p_commune, '')), '');
  clean_localite text := nullif(btrim(coalesce(p_localite, '')), '');
begin
  if not private.actor_manages_structure(p_actor, s.id) then
    raise exception 'Vous ne gérez pas cette structure.' using errcode = '42501';
  end if;
  if s.status <> 'active' or o.is_suspended then
    raise exception 'Cette structure n’accepte pas de nouveaux membres pour le moment.'
      using errcode = '22023';
  end if;
  perform private.inspect_input('commune', clean_commune);
  perform private.inspect_input('localite', clean_localite);
  if clean_region is null or clean_departement is null then
    raise exception 'Indiquez la région et le département.' using errcode = '22023';
  end if;

  if p_is_new then
    if exists (select 1 from public.profiles
               where phone = regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')
                 and deleted_at is null) then
      raise exception 'Un compte existe déjà avec ce numéro.' using errcode = '23505';
    end if;
    insert into public.profiles (id, first_name, last_name, phone, global_role)
    values (p_user, private.checked_name('Prénom', p_first_name),
      private.checked_name('Nom', p_last_name), private.checked_phone(p_phone), 'user');
  elsif not exists (select 1 from public.profiles
                    where id = p_user and deleted_at is null and not is_suspended) then
    raise exception 'Ce compte est introuvable ou bloqué.' using errcode = 'P0002';
  end if;

  select * into existing from public.structure_members
  where structure_id = s.id and user_id = p_user and status in ('pending', 'active')
  for update;
  if found and existing.status = 'active' then
    raise exception 'Cette personne est déjà membre de cette structure.' using errcode = '23505';
  end if;

  insert into public.organization_members (organization_id, user_id, region, departement,
    commune, localite)
  values (o.id, p_user, clean_region, clean_departement, clean_commune, clean_localite)
  on conflict (organization_id, user_id) do update
  set region = excluded.region, departement = excluded.departement,
      commune = coalesce(excluded.commune, public.organization_members.commune),
      localite = coalesce(excluded.localite, public.organization_members.localite);

  select * into om from public.organization_members
  where organization_id = o.id and user_id = p_user for update;
  update public.organization_members
  set member_number = coalesce(member_number, private.next_member_number(o.id)),
      status = 'active', joined_at = coalesce(joined_at, now())
  where id = om.id
  returning * into om;

  if existing.id is not null then
    update public.structure_members
    set status = 'active', decided_at = now(), decided_by = p_actor
    where id = existing.id;
  else
    insert into public.structure_members (structure_id, user_id, status, decided_at, decided_by)
    values (s.id, p_user, 'active', now(), p_actor);
  end if;

  insert into public.notifications (user_id, type, title, body, link)
  values (p_user, 'organization', private.structure_label(s.id),
    format('Vous avez été inscrit comme membre. Votre numéro de membre : %s.', om.member_number),
    '/espace/' || o.slug);
  perform private.audit(p_actor, 'structure_member_decided',
    format('a inscrit directement un membre dans « %s » (%s)', s.name, o.short_name));

  return jsonb_build_object('userId', p_user, 'memberNumber', om.member_number);
end;
$$;

revoke all on function public.svc_org_member_add(uuid, uuid, uuid, boolean, text, text, text,
  text, text, text, text) from public, anon, authenticated;
grant execute on function public.svc_org_member_add(uuid, uuid, uuid, boolean, text, text, text,
  text, text, text, text) to service_role;

-- Tableau de bord : collectes des 12 derniers mois, structures les plus en retard,
-- demandes à traiter, derniers paiements (structures visibles du compte connecté).
create or replace function public.organization_dashboard(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  o public.organizations := private.require_org_by_slug(p_slug);
  visible uuid[];
begin
  select coalesce(array_agg(s.id), '{}') into visible
  from public.org_structures s
  where s.organization_id = o.id and private.views_structure_money(s.id);

  return jsonb_build_object(
    'monthly', coalesce((
      select jsonb_agg(jsonb_build_object('month', to_char(m.month, 'YYYY-MM'), 'amount', m.amount)
                       order by m.month)
      from (
        select gs.month, coalesce(sum(p.amount), 0) as amount
        from generate_series(date_trunc('month', current_date) - interval '11 months',
                             date_trunc('month', current_date), interval '1 month') gs(month)
        left join public.org_payments p
          on p.cancelled_at is null and date_trunc('month', p.created_at) = gs.month
          and p.fund_id in (select f.id from public.org_funds f where f.structure_id = any (visible))
        group by gs.month
      ) m
    ), '[]'::jsonb),
    'lateStructures', coalesce((
      select jsonb_agg(t.x order by (t.x ->> 'remaining')::int desc)
      from (
        select jsonb_build_object('id', s.id, 'name', s.name,
          'remaining', sum(i.amount_due - i.amount_paid),
          'lateMembers', count(distinct i.user_id)) as x
        from public.org_installments i
        join public.org_funds f on f.id = i.fund_id
        join public.org_structures s on s.id = f.structure_id
        where s.id = any (visible) and i.exempted_at is null and i.due_date < current_date
          and i.amount_paid < i.amount_due
        group by s.id, s.name
        order by sum(i.amount_due - i.amount_paid) desc
        limit 5
      ) t
    ), '[]'::jsonb),
    'pending', coalesce((
      select jsonb_agg(t.x order by t.x ->> 'requestedAt')
      from (
        select jsonb_build_object('id', sm.id, 'structureId', s.id, 'structureName', s.name,
          'firstName', p.first_name, 'lastName', p.last_name, 'requestedAt', sm.requested_at) as x
        from public.structure_members sm
        join public.org_structures s on s.id = sm.structure_id
        join public.profiles p on p.id = sm.user_id
        where s.id = any (visible) and sm.status = 'pending'
        order by sm.requested_at
        limit 8
      ) t
    ), '[]'::jsonb),
    'recentPayments', coalesce((
      select jsonb_agg(t.x order by t.x ->> 'createdAt' desc)
      from (
        select jsonb_build_object('id', p.id, 'amount', p.amount, 'createdAt', p.created_at,
          'firstName', pr.first_name, 'lastName', pr.last_name, 'structureName', s.name,
          'fundName', f.name) as x
        from public.org_payments p
        join public.org_funds f on f.id = p.fund_id
        join public.org_structures s on s.id = f.structure_id
        join public.profiles pr on pr.id = p.user_id
        where s.id = any (visible) and p.cancelled_at is null
        order by p.created_at desc
        limit 6
      ) t
    ), '[]'::jsonb)
  );
end;
$$;

-- Toutes les caisses visibles, avec leur structure et leurs totaux.
create or replace function public.organization_funds(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  o public.organizations := private.require_org_by_slug(p_slug);
begin
  return coalesce((
    select jsonb_agg(private.org_fund_json(f) || jsonb_build_object('structureName', s.name)
                     order by s.name, f.is_closed, f.created_at)
    from public.org_funds f
    join public.org_structures s on s.id = f.structure_id
    where s.organization_id = o.id and private.views_structure_money(s.id)
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.organization_dashboard(text), public.organization_funds(text)
  from public, anon;
grant execute on function public.organization_dashboard(text), public.organization_funds(text)
  to authenticated;
