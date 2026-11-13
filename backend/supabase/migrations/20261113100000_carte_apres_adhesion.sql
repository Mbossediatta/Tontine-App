-- Carte de membre seulement après le paiement des frais d'adhésion.
--
-- Tant qu'il reste une échéance d'adhésion non soldée (ni payée en entier, ni exemptée)
-- dans une structure où le membre est actif, il n'a pas de carte : my_member_card renvoie
-- seulement { "pending": "adhesion", "amountDue": … } pour que l'appli l'invite à payer,
-- et le QR code d'une carte déjà téléchargée est montré « non valide ». Une organisation
-- sans caisse d'adhésion n'est pas concernée.
--
-- L'adhésion se paie une seule fois : dès qu'une échéance d'adhésion de l'organisation
-- est soldée, la carte est acquise, même si le membre rejoint ensuite une autre structure
-- qui a ses propres frais d'adhésion. Les cotisations et autres caisses n'y touchent pas.
-- Seul un paiement annulé (donc jamais vraiment payé) fait revenir le reste dû.
--
-- Sur la carte, une structure ne figure qu'une fois ses propres frais d'adhésion réglés
-- (tout de suite si elle n'en demande pas). En attendant, elle est listée à part
-- (pendingStructures) avec son reste à payer, pour que l'appli invite à payer.

-- Reste à payer sur les frais d'adhésion d'une structure (0 : rien à payer).
create or replace function private.org_structure_adhesion_due(p_structure uuid, p_user uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(i.amount_due - i.amount_paid), 0)::integer
  from public.org_installments i
  join public.org_funds f on f.id = i.fund_id
  where f.structure_id = p_structure and i.user_id = p_user and f.kind = 'adhesion'
    and i.exempted_at is null and i.amount_paid < i.amount_due
$$;

revoke all on function private.org_structure_adhesion_due(uuid, uuid) from public;

-- Reste à payer pour obtenir la carte (0 : carte disponible).
create or replace function private.org_adhesion_due(p_org uuid, p_user uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when exists (
    -- Adhésion déjà réglée une fois dans l'organisation : carte acquise.
    select 1
    from public.org_installments i
    join public.org_funds f on f.id = i.fund_id
    join public.org_structures s on s.id = f.structure_id
    where s.organization_id = p_org and i.user_id = p_user and f.kind = 'adhesion'
      and (i.exempted_at is not null or i.amount_paid >= i.amount_due)
  ) then 0 else (
  select coalesce(sum(i.amount_due - i.amount_paid), 0)::integer
  from public.org_installments i
  join public.org_funds f on f.id = i.fund_id
  join public.org_structures s on s.id = f.structure_id
  where s.organization_id = p_org
    and i.user_id = p_user
    and f.kind = 'adhesion'
    and i.exempted_at is null
    and i.amount_paid < i.amount_due
    and exists (
      select 1 from public.structure_members sm
      where sm.structure_id = f.structure_id and sm.user_id = p_user and sm.status = 'active'
    )
  ) end
$$;

revoke all on function private.org_adhesion_due(uuid, uuid) from public;

-- Carte du compte connecté.
create or replace function public.my_member_card(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  o public.organizations := private.require_org_by_slug(p_slug);
  m public.organization_members;
  p public.profiles;
  v_due integer;
begin
  select * into m from public.organization_members
  where organization_id = o.id and user_id = uid;
  if not found or m.status <> 'active' or m.member_number is null then
    return null;
  end if;
  v_due := private.org_adhesion_due(o.id, uid);
  if v_due > 0 then
    return jsonb_build_object('pending', 'adhesion', 'amountDue', v_due);
  end if;
  select * into p from public.profiles where id = uid;
  return jsonb_build_object(
    'organization', jsonb_build_object('name', o.name, 'shortName', o.short_name,
      'color', o.color, 'logoUrl', o.logo_url, 'slug', o.slug),
    'firstName', p.first_name, 'lastName', p.last_name, 'avatarUrl', p.avatar_url,
    'memberNumber', m.member_number, 'joinedAt', m.joined_at,
    'region', m.region, 'departement', m.departement, 'commune', m.commune,
    'token', m.card_token,
    'structures', coalesce((
      select jsonb_agg(s.name order by sm.decided_at nulls last, s.name)
      from public.structure_members sm join public.org_structures s on s.id = sm.structure_id
      where sm.user_id = uid and sm.status = 'active' and s.organization_id = o.id
        and private.org_structure_adhesion_due(s.id, uid) = 0
    ), '[]'::jsonb),
    'pendingStructures', coalesce((
      select jsonb_agg(jsonb_build_object('name', s.name,
          'amountDue', private.org_structure_adhesion_due(s.id, uid))
        order by sm.decided_at nulls last, s.name)
      from public.structure_members sm join public.org_structures s on s.id = sm.structure_id
      where sm.user_id = uid and sm.status = 'active' and s.organization_id = o.id
        and private.org_structure_adhesion_due(s.id, uid) > 0
    ), '[]'::jsonb),
    'roles', coalesce((
      select jsonb_agg(private.org_role_label(r.role)) from public.organization_roles r
      where r.organization_id = o.id and r.user_id = uid
    ), '[]'::jsonb) || coalesce((
      select jsonb_agg(initcap(replace(sr.role::text, '_', ' ')) || ' · ' || s.name)
      from public.structure_roles sr join public.org_structures s on s.id = sr.structure_id
      where sr.user_id = uid and s.organization_id = o.id
    ), '[]'::jsonb)
  );
end;
$$;

-- Vérification publique (scan du QR code) : adhésion non soldée = carte non valide.
create or replace function public.org_card_verify(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  m public.organization_members;
  o public.organizations;
  p public.profiles;
  is_valid boolean;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then
    return null;
  end if;
  select * into m from public.organization_members where card_token = p_token;
  if not found then
    return null;
  end if;
  select * into o from public.organizations where id = m.organization_id;
  select * into p from public.profiles where id = m.user_id;
  is_valid := m.status = 'active' and m.member_number is not null and not o.is_suspended
    and p.deleted_at is null and private.org_adhesion_due(o.id, m.user_id) = 0;
  if not is_valid then
    -- Carte plus valable : on le dit, sans révéler qui en était le titulaire.
    return jsonb_build_object(
      'organization', jsonb_build_object('name', o.name, 'shortName', o.short_name,
        'color', o.color, 'logoUrl', o.logo_url),
      'valid', false, 'status', m.status,
      'firstName', '', 'lastName', '', 'avatarUrl', null,
      'memberNumber', null, 'joinedAt', null, 'checkedAt', now()
    );
  end if;
  return jsonb_build_object(
    'organization', jsonb_build_object('name', o.name, 'shortName', o.short_name,
      'color', o.color, 'logoUrl', o.logo_url),
    'valid', true, 'status', m.status,
    'firstName', p.first_name, 'lastName', p.last_name, 'avatarUrl', p.avatar_url,
    'memberNumber', m.member_number, 'joinedAt', m.joined_at, 'checkedAt', now()
  );
end;
$$;

revoke all on function public.my_member_card(text), public.org_card_verify(text) from public;
grant execute on function public.my_member_card(text) to authenticated;
grant execute on function public.org_card_verify(text) to anon, authenticated;
