-- Paiement en ligne des militants (Wave, Orange Money) par PayTech (cahier § 8.2).
--
-- Circuit : le militant choisit une caisse (frais d'adhésion, cotisation…) et le montant ;
-- le serveur prépare une demande (org_payment_intents), PayTech encaisse, puis sa
-- notification signée confirme. Seule cette confirmation crée le paiement, son reçu et
-- son écriture comptable : un paiement initié ou en attente n'est jamais compté comme
-- encaissé. La référence PayTech est unique (pas de doublon, pas de fausse confirmation).
--
-- Les frais du service de paiement sont payés en plus par le militant (même taux que la
-- plateforme) ; la caisse reçoit le montant de la cotisation, entier.

create table public.org_payment_intents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  fund_id uuid not null references public.org_funds (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete restrict,
  amount integer not null check (amount > 0),
  service_fee integer not null default 0 check (service_fee >= 0),
  method public.org_payment_method not null check (method in ('wave', 'orange_money')),
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed')),
  provider_token text,
  provider_ref text,
  payer_phone text,
  payment_id uuid references public.org_payments (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index org_payment_intents_user_idx on public.org_payment_intents (user_id, created_at desc);
create unique index org_payment_intents_ref_key on public.org_payment_intents (provider_ref)
  where provider_ref is not null;

create trigger org_payment_intents_updated_at
  before update on public.org_payment_intents
  for each row execute function private.set_updated_at();

alter table public.org_payment_intents enable row level security;
revoke all on public.org_payment_intents from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Enregistrement d'un paiement confirmé (répartition sur les échéances)
-- ---------------------------------------------------------------------------

create or replace function private.org_payment_apply(
  p_fund uuid, p_user uuid, p_amount integer, p_method public.org_payment_method,
  p_reference text, p_recorded_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.org_funds := private.require_fund(p_fund);
  s public.org_structures := private.require_structure(f.structure_id);
  o public.organizations := private.require_organization(s.organization_id);
  left_amount integer := p_amount;
  v_payment uuid;
  receipt text;
  i public.org_installments;
  part integer;
begin
  receipt := private.next_receipt_number(o.id);
  insert into public.org_payments (fund_id, user_id, amount, method, reference,
    receipt_number, recorded_by)
  values (f.id, p_user, p_amount, p_method, p_reference, receipt, p_recorded_by)
  returning id into v_payment;

  if f.kind <> 'volontaire' then
    perform private.org_generate_installments(f.id);
    for i in
      select * from public.org_installments x
      where x.fund_id = f.id and x.user_id = p_user and x.exempted_at is null
        and x.amount_paid < x.amount_due
      order by x.due_date
      for update
    loop
      exit when left_amount <= 0;
      part := least(left_amount, i.amount_due - i.amount_paid);
      insert into public.org_payment_allocations (payment_id, installment_id, amount)
      values (v_payment, i.id, part);
      update public.org_installments
      set amount_paid = amount_paid + part,
          paid_at = case when amount_paid + part >= amount_due then now() else null end
      where id = i.id;
      left_amount := left_amount - part;
    end loop;
  end if;

  perform private.notify(p_user, 'organization', private.structure_label(s.id),
    format('Paiement de %s reçu pour « %s ». Reçu n° %s.',
      private.format_amount(p_amount), f.name, receipt),
    '/espace/' || o.slug || '/cotisations');
  return v_payment;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ce que le militant peut payer en ligne
-- ---------------------------------------------------------------------------

-- Reste à payer d'une caisse : exigible (échéances passées ou du jour) et total.
create or replace function private.org_open_amounts(p_fund uuid, p_user uuid)
returns table (due_now integer, total_open integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(sum(x.amount_due - x.amount_paid) filter (where x.due_date <= current_date), 0)::integer,
    coalesce(sum(x.amount_due - x.amount_paid), 0)::integer
  from public.org_installments x
  where x.fund_id = p_fund and x.user_id = p_user and x.exempted_at is null
    and x.amount_paid < x.amount_due
$$;

-- Prépare une demande de paiement (appelée par l'Edge Function, compte vérifié).
create or replace function public.svc_org_payment_prepare(
  p_user uuid, p_fund uuid, p_amount integer, p_method public.org_payment_method
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.org_funds := private.require_fund(p_fund);
  s public.org_structures := private.require_structure(f.structure_id);
  o public.organizations := private.require_organization(s.organization_id);
  open_total integer;
  fee_percent numeric := coalesce(
    (select (x.payment ->> 'feePercent')::numeric from public.platform_settings x), 0);
  pay_mode text := coalesce((select x.payment ->> 'mode' from public.platform_settings x), 'test');
  v_fee integer;
  v_id uuid;
begin
  if o.is_suspended or s.status <> 'active' or f.is_closed then
    raise exception 'Cette caisse n’accepte pas de paiement pour le moment.' using errcode = '22023';
  end if;
  if p_method not in ('wave', 'orange_money') then
    raise exception 'Choisissez Wave ou Orange Money.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.structure_members sm
    where sm.structure_id = s.id and sm.user_id = p_user and sm.status = 'active'
  ) then
    raise exception 'Vous n’êtes pas membre de cette structure.' using errcode = '42501',
      hint = 'access_denied:organization';
  end if;
  if (select count(*) from public.org_payment_intents x
      where x.user_id = p_user and x.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Trop de tentatives de paiement. Réessayez dans une heure.' using errcode = 'P0001',
      hint = 'too_many';
  end if;
  if coalesce(p_amount, 0) < 100 or p_amount > 2000000 then
    raise exception 'Montant invalide (100 FCFA au moins).' using errcode = '22023';
  end if;
  if f.kind <> 'volontaire' then
    perform private.org_generate_installments(f.id);
    select a.total_open into open_total from private.org_open_amounts(f.id, p_user) a;
    if open_total = 0 then
      raise exception 'Rien à payer dans cette caisse : vous êtes à jour.' using errcode = '22023';
    end if;
    if p_amount > open_total then
      raise exception 'Le montant dépasse ce qui reste à payer (%).', private.format_amount(open_total)
        using errcode = '22023';
    end if;
  end if;

  v_fee := ceil(p_amount * fee_percent / 100)::integer;
  insert into public.org_payment_intents (organization_id, fund_id, user_id, amount,
    service_fee, method)
  values (o.id, f.id, p_user, p_amount, v_fee, p_method)
  returning id into v_id;

  return jsonb_build_object(
    'intentId', v_id, 'amount', p_amount, 'serviceFee', v_fee, 'total', p_amount + v_fee,
    'fundName', f.name, 'structureName', s.name, 'shortName', o.short_name,
    'slug', o.slug, 'mode', pay_mode);
end;
$$;

create or replace function public.svc_org_payment_set_token(p_intent uuid, p_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.org_payment_intents set provider_token = p_token
  where id = p_intent and status = 'pending'
$$;

-- Organisation d'une demande (clés PayTech de l'organisation pour vérifier l'IPN).
create or replace function public.svc_org_payment_org(p_intent uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('shortName', o.short_name, 'slug', o.slug, 'userId', x.user_id,
    'amount', x.amount, 'serviceFee', x.service_fee, 'status', x.status)
  from public.org_payment_intents x join public.organizations o on o.id = x.organization_id
  where x.id = p_intent
$$;

-- Confirmation (notification PayTech vérifiée, ou simulation locale).
-- Renvoie ok, already, mismatch, not_found ou closed.
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
  v_payment uuid;
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

create or replace function public.svc_org_payment_fail(p_intent uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.org_payment_intents set status = 'failed'
  where id = p_intent and status = 'pending'
$$;

-- Le militant suit sa demande (page de retour après PayTech).
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
    'receiptNumber', (select p.receipt_number from public.org_payments p where p.id = x.payment_id),
    'fundName', (select f.name from public.org_funds f where f.id = x.fund_id));
end;
$$;

-- Ce que le militant a à payer, caisse par caisse (pour proposer « payer maintenant »).
create or replace function public.my_org_payables(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  o public.organizations := private.require_org_by_slug(p_slug);
  f record;
begin
  for f in
    select x.id from public.org_funds x
    join public.org_structures s on s.id = x.structure_id
    join public.structure_members sm on sm.structure_id = s.id and sm.user_id = uid
      and sm.status = 'active'
    where s.organization_id = o.id and not x.is_closed and x.kind <> 'volontaire'
  loop
    perform private.org_generate_installments(f.id);
  end loop;
  return jsonb_build_object(
    'feePercent', coalesce((select (x.payment ->> 'feePercent')::numeric
                            from public.platform_settings x), 0),
    'funds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'fundId', x.id, 'fundName', x.name, 'kind', x.kind, 'amount', x.amount,
        'structureId', s.id, 'structureName', s.name,
        'dueNow', a.due_now, 'totalOpen', a.total_open) order by s.name, x.name)
      from public.org_funds x
      join public.org_structures s on s.id = x.structure_id and s.status = 'active'
      join public.structure_members sm on sm.structure_id = s.id and sm.user_id = uid
        and sm.status = 'active'
      cross join lateral private.org_open_amounts(x.id, uid) a
      where s.organization_id = o.id and not x.is_closed
        and (x.kind = 'volontaire' or a.total_open > 0)
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function
  public.svc_org_payment_prepare(uuid, uuid, integer, public.org_payment_method),
  public.svc_org_payment_set_token(uuid, text),
  public.svc_org_payment_org(uuid),
  public.svc_org_payment_confirm(uuid, integer, text, text),
  public.svc_org_payment_fail(uuid),
  public.org_payment_intent_status(uuid),
  public.my_org_payables(text)
  from public, anon, authenticated;
grant execute on function
  public.svc_org_payment_prepare(uuid, uuid, integer, public.org_payment_method),
  public.svc_org_payment_set_token(uuid, text),
  public.svc_org_payment_org(uuid),
  public.svc_org_payment_confirm(uuid, integer, text, text),
  public.svc_org_payment_fail(uuid)
  to service_role;
grant execute on function
  public.org_payment_intent_status(uuid),
  public.my_org_payables(text)
  to authenticated;
revoke all on function private.org_payment_apply(uuid, uuid, integer, public.org_payment_method,
  text, uuid) from public, anon, authenticated;
