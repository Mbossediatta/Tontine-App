-- Test de sécurité AFP (2026-11-11), corrections :
-- 1. Confirmation d'un paiement en ligne : le jeton PayTech de la notification doit être
--    celui reçu à la création de CE paiement. La référence du paiement voyage dans
--    custom_field, qui n'est pas couvert par la signature : sans ce contrôle, une
--    notification authentique pouvait être détournée vers un autre paiement du même montant.
-- 2. Vérification d'une carte de membre (page publique du QR code) : une carte qui n'est
--    plus valable (membre sorti, suspendu, supprimé) ne montre plus le nom, la photo ni le
--    numéro de la personne.

create or replace function public.svc_org_payment_confirm(p_intent uuid, p_charged integer, p_provider_ref text, p_phone text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  x public.org_payment_intents;
  f public.org_funds;
  o public.organizations;
  v_payment uuid;
  v_entry uuid;
  v_number text;
  target uuid;
begin
  select * into x from public.org_payment_intents where id = p_intent for update;
  if not found then
    return 'not_found';
  end if;
  if x.status = 'paid' then
    return 'already';
  end if;
  if x.status <> 'pending' then
    return 'closed';
  end if;
  if p_charged <> x.amount + x.service_fee then
    return 'mismatch';
  end if;
  -- Le jeton doit être celui que PayTech a donné pour ce paiement précis.
  if p_provider_ref is null or x.provider_token is null
      or p_provider_ref <> x.provider_token then
    return 'mismatch';
  end if;
  if p_provider_ref is null or exists (
    select 1 from public.org_payment_intents y
    where y.provider_ref = p_provider_ref and y.id <> x.id
  ) then
    return 'mismatch';
  end if;
  if x.fund_id is null then
    -- Contribution volontaire au fonds commun.
    o := private.require_organization(x.organization_id);
    v_entry := private.entry_create(o.id, 'contribution_volontaire', x.amount,
      format('Contribution volontaire au fonds commun – %s', private.full_name(x.user_id)),
      jsonb_build_object('source_kind', 'membre', 'source_user', x.user_id,
        'origin', private.full_name(x.user_id), 'method', x.method,
        'reference', left(p_provider_ref, 80), 'created_by', x.user_id));
    perform private.entry_move(v_entry, 'treasury', null, 'common', null, x.amount);
    select e.entry_number into v_number from public.org_entries e where e.id = v_entry;
    update public.org_payment_intents
    set status = 'paid', provider_ref = p_provider_ref, payer_phone = p_phone, entry_id = v_entry
    where id = x.id;
    perform private.notify(x.user_id, 'organization', o.short_name || ' – Fonds commun',
      format('Merci : votre contribution de %s au fonds commun est enregistrée (n° %s).',
        private.format_amount(x.amount), v_number), null);
    for target in
      select r.user_id from public.organization_roles r
      where r.organization_id = o.id and r.role in ('org_admin', 'finance_admin')
    loop
      perform private.notify(target, 'organization', o.short_name || ' – Fonds commun',
        format('%s a versé %s au fonds commun en ligne.', private.full_name(x.user_id),
          private.format_amount(x.amount)),
        '/espace/' || o.slug || '/admin/fonds-commun');
    end loop;
    return 'ok';
  end if;
  v_payment := private.org_payment_apply(x.fund_id, x.user_id, x.amount, x.method,
    left(p_provider_ref, 80), null);
  update public.org_payment_intents
  set status = 'paid', provider_ref = p_provider_ref, payer_phone = p_phone,
      payment_id = v_payment
  where id = x.id;
  f := private.require_fund(x.fund_id);
  perform private.notify_structure_managers(f.structure_id,
    array['responsable', 'tresorier']::public.structure_role[],
    format('%s a payé %s en ligne (%s) pour « %s ».', private.full_name(x.user_id),
      private.format_amount(x.amount),
      case x.method when 'wave' then 'Wave' else 'Orange Money' end, f.name));
  return 'ok';
end;
$function$
;

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
    and p.deleted_at is null;
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
