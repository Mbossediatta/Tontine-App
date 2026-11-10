-- Paiement en ligne : montants exacts seulement.
--
-- - Frais d'adhésion : le montant exact des frais, en une fois.
-- - Cotisations : une ou plusieurs échéances entières, de la plus ancienne à la plus
--   récente (ex. 1 mensualité, 2 mensualités…), jamais un montant libre ou partiel.
-- - Contributions volontaires : montant libre (rien n'est fixé).

-- Montants autorisés : cumul des restes d'échéances, dans l'ordre des dates.
create or replace function private.org_exact_amounts(p_fund uuid, p_user uuid)
returns table (installments integer, amount integer, last_due date)
language sql
stable
security definer
set search_path = ''
as $$
  select row_number() over w::integer,
         (sum(x.amount_due - x.amount_paid) over w)::integer,
         x.due_date
  from public.org_installments x
  where x.fund_id = p_fund and x.user_id = p_user and x.exempted_at is null
    and x.amount_paid < x.amount_due
  window w as (order by x.due_date, x.id rows between unbounded preceding and current row)
$$;

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

  if f.kind = 'volontaire' then
    if coalesce(p_amount, 0) < 100 or p_amount > 2000000 then
      raise exception 'Montant invalide (100 FCFA au moins).' using errcode = '22023';
    end if;
  else
    perform private.org_generate_installments(f.id);
    if not exists (select 1 from private.org_exact_amounts(f.id, p_user)) then
      raise exception 'Rien à payer dans cette caisse : vous êtes à jour.' using errcode = '22023';
    end if;
    if not exists (
      select 1 from private.org_exact_amounts(f.id, p_user) a
      where a.amount = p_amount and (f.kind <> 'adhesion' or a.installments = (
        select count(*) from private.org_exact_amounts(f.id, p_user)))
    ) then
      raise exception '%', case when f.kind = 'adhesion'
        then 'Les frais d’adhésion se paient en une fois, au montant exact.'
        else 'Payez une ou plusieurs échéances entières, au montant exact.' end
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

-- Ce que le militant peut payer : pour chaque caisse, les montants exacts proposés
-- (1 échéance, 2 échéances… ; les frais d'adhésion en entier).
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
        'frequency', x.frequency, 'structureId', s.id, 'structureName', s.name,
        'dueNow', a.due_now, 'totalOpen', a.total_open,
        'choices', case when x.kind = 'volontaire' then '[]'::jsonb else coalesce((
          select jsonb_agg(jsonb_build_object('installments', c.installments,
            'amount', c.amount, 'lastDue', c.last_due) order by c.installments)
          from private.org_exact_amounts(x.id, uid) c
          where x.kind <> 'adhesion'
             or c.installments = (select count(*) from private.org_exact_amounts(x.id, uid))
        ), '[]'::jsonb) end
      ) order by s.name, x.name)
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

revoke all on function private.org_exact_amounts(uuid, uuid) from public, anon, authenticated;
