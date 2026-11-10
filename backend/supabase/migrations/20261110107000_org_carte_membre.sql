-- Carte de membre numérique avec QR code de vérification (cahier § 5.3).
--
-- Une carte unique par organisation, avec toutes les appartenances du membre (principe
-- privilégié par le cahier). Le QR code porte une adresse de vérification avec un jeton
-- aléatoire propre à chaque fiche (jamais l'identifiant ni le téléphone) : en le
-- scannant, n'importe qui voit si la carte est valide, sans accéder au fichier des
-- militants. Le jeton peut être renouvelé (carte perdue) : l'ancien QR ne vaut plus rien.

alter table public.organization_members
  add column card_token text not null unique
    default replace(gen_random_uuid()::text, '-', '');

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
begin
  select * into m from public.organization_members
  where organization_id = o.id and user_id = uid;
  if not found or m.status <> 'active' or m.member_number is null then
    return null;
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

-- Carte perdue : nouveau jeton, l'ancien QR code n'est plus valable.
create or replace function public.my_member_card_renew(p_slug text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  o public.organizations := private.require_org_by_slug(p_slug);
begin
  update public.organization_members
  set card_token = replace(gen_random_uuid()::text, '-', '')
  where organization_id = o.id and user_id = uid;
end;
$$;

-- Vérification publique (scan du QR code, sans connexion) : seulement ce qui figure déjà
-- sur la carte, et si elle est valide aujourd'hui.
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
  return jsonb_build_object(
    'organization', jsonb_build_object('name', o.name, 'shortName', o.short_name,
      'color', o.color, 'logoUrl', o.logo_url),
    'valid', m.status = 'active' and m.member_number is not null and not o.is_suspended
      and p.deleted_at is null,
    'status', m.status,
    'firstName', p.first_name, 'lastName', p.last_name, 'avatarUrl', p.avatar_url,
    'memberNumber', m.member_number, 'joinedAt', m.joined_at,
    'checkedAt', now()
  );
end;
$$;

revoke all on function public.my_member_card(text), public.my_member_card_renew(text),
  public.org_card_verify(text) from public;
grant execute on function public.my_member_card(text), public.my_member_card_renew(text)
  to authenticated;
grant execute on function public.org_card_verify(text) to anon, authenticated;
