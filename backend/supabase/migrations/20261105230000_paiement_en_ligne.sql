-- Étape 9 — Paiement en ligne (PayTech : Wave, Orange Money, Free Money).
-- Parcours : payments-initiate → page PayTech → payments-ipn (notification signée).
-- Section 4.7 du cahier d'intégration ; documentation PayTech : docs.intech.sn/doc_paytech.php.
--
-- Le membre paie sa cotisation (toutes ses parts) + frais d'adhésion dus + pénalité, et en
-- plus les frais PayTech (service_fee_amount), jamais pris sur la cagnotte.
-- Les fonctions svc_* sont réservées aux Edge Functions (service_role).

-- Paiement à régler par le membre pour ce tour : crée (ou met à jour) la ligne « pending ».
-- Renvoie ce qu'il faut pour la demande PayTech.
create or replace function public.svc_payment_prepare(
  p_user uuid, p_round uuid, p_method public.payment_method
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.rounds;
  g public.groups;
  shares integer;
  contribution integer;
  fee integer;
  penalty integer;
  amount_due integer;
  service_fee integer;
  fee_percent numeric := coalesce(
    (select (s.payment ->> 'feePercent')::numeric from public.platform_settings s), 0);
  pay_mode text := coalesce(
    (select s.payment ->> 'mode' from public.platform_settings s), 'test');
  existing public.payments;
  saved_id uuid;
begin
  if p_method = 'cash' then
    raise exception 'Choisissez Wave, Orange Money ou Free Money.' using errcode = '22023';
  end if;
  select * into r from public.rounds where id = p_round;
  if not found then
    raise exception 'Ce tour n’existe pas.' using errcode = 'P0002';
  end if;
  select * into g from public.groups where id = r.group_id;
  select count(*) into shares from public.memberships
  where group_id = g.id and user_id = p_user and status = 'active';
  if shares = 0 then
    raise exception 'Vous ne faites pas partie de ce groupe.' using errcode = '42501';
  end if;
  perform private.assert_group_open(g);
  if r.status <> 'open' then
    raise exception 'Ce tour n’accepte plus de paiement.' using errcode = '22023';
  end if;
  if private.member_status(r.id, p_user) = 'paid' then
    raise exception 'Vous avez déjà payé ce tour.' using errcode = '23505';
  end if;

  contribution := g.contribution_amount * g.turn_length * shares;
  fee := case when exists (
      select 1 from public.platform_earnings e
      where e.group_id = g.id and e.user_id = p_user and e.kind = 'membership_fee'
    ) then 0 else g.membership_fee_amount end;
  penalty := coalesce((select sum(amount) from public.penalties
    where round_id = r.id and user_id = p_user), 0);
  amount_due := contribution + fee + penalty;
  -- Frais payés par le membre : arrondis au franc supérieur (serviceFee, lib/tontine.ts).
  service_fee := ceil(amount_due * fee_percent / 100)::integer;

  select * into existing from public.payments
  where round_id = r.id and user_id = p_user and status in ('pending', 'late')
  for update;
  if found then
    -- Nouvel essai : montants à jour, ancien jeton PayTech abandonné.
    update public.payments
    set amount = amount_due, contribution_amount = contribution, membership_fee_amount = fee,
      late_penalty_amount = penalty, service_fee_amount = service_fee, method = p_method,
      status = 'pending', provider_token = null, created_at = now()
    where id = existing.id
    returning id into saved_id;
  else
    insert into public.payments (round_id, user_id, amount, contribution_amount,
      membership_fee_amount, late_penalty_amount, service_fee_amount, method, status)
    values (r.id, p_user, amount_due, contribution, fee, penalty, service_fee, p_method, 'pending')
    returning id into saved_id;
  end if;

  return jsonb_build_object(
    'paymentId', saved_id,
    'amount', amount_due,
    'serviceFee', service_fee,
    'total', amount_due + service_fee,
    'groupName', g.name,
    'roundNumber', r.number,
    'mode', pay_mode
  );
end;
$$;

-- Jeton de la page de paiement PayTech, gardé pour vérifier le statut si besoin.
create or replace function public.svc_payment_set_token(p_payment uuid, p_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.payments set provider_token = p_token where id = p_payment and status = 'pending'
$$;

-- Paiement confirmé (notification PayTech vérifiée, ou simulation locale).
-- Idempotent : un paiement déjà payé ne change pas. Le montant demandé à PayTech
-- (item_price) doit être exactement amount + service_fee_amount.
-- Résultat : 'ok', 'already', 'not_found', 'mismatch' ou 'closed'.
create or replace function public.svc_payment_confirm(
  p_payment uuid, p_charged integer, p_provider_ref text, p_phone text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.payments;
  r public.rounds;
  g public.groups;
begin
  select * into p from public.payments where id = p_payment for update;
  if not found then
    return 'not_found';
  end if;
  if p.status = 'paid' then
    return 'already';
  end if;
  if p_charged is distinct from p.amount + p.service_fee_amount then
    return 'mismatch';
  end if;
  select * into r from public.rounds where id = p.round_id;
  select * into g from public.groups where id = r.group_id;
  -- Payé chez PayTech pendant qu'un autre paiement (espèces) réglait déjà le tour : on
  -- garde la trace, le litige sera traité par le super admin.
  if private.member_status(r.id, p.user_id) = 'paid' then
    update public.payments set status = 'failed', provider_ref = p_provider_ref where id = p.id;
    return 'closed';
  end if;

  update public.payments
  set status = 'paid', paid_at = now(), provider_ref = p_provider_ref
  where id = p.id;
  if p_provider_ref is not null then
    insert into public.provider_ledger (ref, phone, amount, at, payment_id)
    values (p_provider_ref, p_phone, p_charged, now(), p.id)
    on conflict (ref) do nothing;
  end if;
  insert into public.platform_earnings (group_id, kind, amount, payment_id, round_id, user_id)
  select g.id, e.kind::public.earning_kind, e.amount, p.id, r.id, p.user_id
  from (values ('membership_fee', p.membership_fee_amount), ('late_penalty', p.late_penalty_amount))
    e(kind, amount)
  where e.amount > 0;

  perform private.notify(p.user_id, 'payment', 'Paiement reçu',
    format('%s : %s reçus pour le tour %s.', g.name, private.format_amount(p.amount), r.number),
    '/groupes/' || g.id);
  perform private.notify_managers(g.id, 'payment', 'Paiement reçu',
    format('%s a payé %s.', private.full_name(p.user_id), private.format_amount(p.amount)));
  perform private.refresh_round(r.id);
  return 'ok';
end;
$$;

-- Paiement annulé ou refusé chez PayTech : l'essai passe en échec (on peut réessayer).
create or replace function public.svc_payment_fail(p_payment uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.payments set status = 'failed' where id = p_payment and status = 'pending';
  return case when found then 'ok' else 'ignored' end;
end;
$$;

-- Propriétaire d'un paiement (simulation locale : seul le payeur la déclenche).
create or replace function public.svc_payment_owner(p_payment uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select user_id from public.payments where id = p_payment
$$;

-- Reçu d'un paiement pour son auteur (type PaymentReceipt du frontend).
create or replace function public.payment_receipt(p_payment uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  p public.payments;
  r public.rounds;
  g public.groups;
begin
  select * into p from public.payments where id = p_payment;
  if not found or p.user_id <> uid then
    raise exception 'Paiement introuvable.' using errcode = 'P0002';
  end if;
  select * into r from public.rounds where id = p.round_id;
  select * into g from public.groups where id = r.group_id;
  return jsonb_build_object(
    'payment', jsonb_build_object(
      'id', p.id, 'roundId', p.round_id, 'userId', p.user_id, 'amount', p.amount,
      'contributionAmount', p.contribution_amount, 'membershipFeeAmount', p.membership_fee_amount,
      'latePenaltyAmount', p.late_penalty_amount, 'serviceFeeAmount', p.service_fee_amount,
      'method', p.method, 'providerRef', p.provider_ref, 'status', p.status,
      'paidAt', p.paid_at, 'createdAt', p.created_at),
    'groupId', g.id,
    'groupName', g.name,
    'roundNumber', r.number,
    'cycle', r.cycle
  );
end;
$$;

do $grants$
declare
  fn text;
begin
  foreach fn in array array[
    'svc_payment_prepare(uuid, uuid, public.payment_method)',
    'svc_payment_set_token(uuid, text)', 'svc_payment_confirm(uuid, integer, text, text)',
    'svc_payment_fail(uuid)', 'svc_payment_owner(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
  execute 'revoke all on function public.payment_receipt(uuid) from public, anon';
  execute 'grant execute on function public.payment_receipt(uuid) to authenticated';
end;
$grants$;
