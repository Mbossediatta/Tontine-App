-- « Contribuer » : versement volontaire en ligne d'un militant au fonds commun
-- (cahier § 2.4, § 3.3 C). Montant libre ; Wave ou Orange Money par PayTech, comme les
-- cotisations. Une demande sans caisse (fund_id vide) vise le fonds commun : sa
-- confirmation crée une opération « contribution volontaire » (trésorerie → fonds commun),
-- dont le numéro sert de reçu. Les versements à la caisse volontaire d'une structure
-- passent par le paiement des caisses (déjà en place).

alter table public.org_payment_intents
  alter column fund_id drop not null,
  add column entry_id uuid references public.org_entries (id) on delete restrict;

create or replace function public.svc_org_contribution_prepare(
  p_user uuid, p_slug text, p_amount integer, p_method public.org_payment_method
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.organizations := private.require_org_by_slug(p_slug);
  fee_percent numeric := coalesce(
    (select (x.payment ->> 'feePercent')::numeric from public.platform_settings x), 0);
  pay_mode text := coalesce((select x.payment ->> 'mode' from public.platform_settings x), 'test');
  v_fee integer;
  v_id uuid;
begin
  if o.is_suspended then
    raise exception 'Les contributions sont suspendues pour le moment.' using errcode = '22023';
  end if;
  if p_method not in ('wave', 'orange_money') then
    raise exception 'Choisissez Wave ou Orange Money.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.organization_members m
    where m.organization_id = o.id and m.user_id = p_user and m.status = 'active'
  ) then
    raise exception 'Seuls les membres actifs peuvent contribuer en ligne.' using errcode = '42501',
      hint = 'access_denied:organization';
  end if;
  if (select count(*) from public.org_payment_intents x
      where x.user_id = p_user and x.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Trop de tentatives de paiement. Réessayez dans une heure.' using errcode = 'P0001',
      hint = 'too_many';
  end if;
  if coalesce(p_amount, 0) < 100 or p_amount > 2000000 then
    raise exception 'Montant invalide (entre 100 FCFA et 2 000 000 FCFA).' using errcode = '22023';
  end if;

  v_fee := ceil(p_amount * fee_percent / 100)::integer;
  insert into public.org_payment_intents (organization_id, fund_id, user_id, amount,
    service_fee, method)
  values (o.id, null, p_user, p_amount, v_fee, p_method)
  returning id into v_id;

  return jsonb_build_object(
    'intentId', v_id, 'amount', p_amount, 'serviceFee', v_fee, 'total', p_amount + v_fee,
    'fundName', 'Fonds commun', 'structureName', o.name, 'shortName', o.short_name,
    'slug', o.slug, 'mode', pay_mode);
end;
$$;

create or replace function public.svc_org_payment_confirm(
  p_intent uuid, p_charged integer, p_provider_ref text, p_phone text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.org_payment_intent_status(p_intent uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  x public.org_payment_intents;
begin
  select * into x from public.org_payment_intents where id = p_intent and user_id = uid;
  if not found then
    raise exception 'Paiement introuvable.' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'status', x.status, 'amount', x.amount, 'serviceFee', x.service_fee, 'method', x.method,
    'paymentId', x.payment_id,
    'receiptNumber', coalesce(
      (select p.receipt_number from public.org_payments p where p.id = x.payment_id),
      (select e.entry_number from public.org_entries e where e.id = x.entry_id)),
    'fundName', coalesce((select f.name from public.org_funds f where f.id = x.fund_id),
      'Fonds commun'),
    'common', x.fund_id is null);
end;
$$;

-- Mes contributions au fonds commun (historique du militant).
create or replace function public.my_org_contributions(p_slug text)
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
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'number', e.entry_number, 'amount', e.amount, 'method', e.method,
      'reference', e.reference, 'createdAt', e.created_at, 'cancelledAt', e.cancelled_at)
      order by e.created_at desc)
    from public.org_entries e
    where e.organization_id = o.id and e.source_user = uid
      and e.nature in ('contribution_volontaire', 'don') and e.source_kind = 'membre'
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.svc_org_contribution_prepare(uuid, text, integer, public.org_payment_method),
  public.my_org_contributions(text) from public, anon, authenticated;
grant execute on function public.svc_org_contribution_prepare(uuid, text, integer, public.org_payment_method)
  to service_role;
grant execute on function public.my_org_contributions(text) to authenticated;
