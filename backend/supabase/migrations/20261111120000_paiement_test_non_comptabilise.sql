-- Paiements en ligne de l'organisation en MODE TEST PayTech (décision du 2026-11-11) :
-- en mode test, PayTech ne débite que 100 à 150 FCFA mais sa notification annonce le prix
-- complet. Un tel paiement n'est donc JAMAIS comptabilisé : pas de reçu, échéance toujours
-- due, rien dans les comptes. Il passe au statut « test » et le membre en est informé.

alter table public.org_payment_intents
  add column test_mode boolean not null default false;

alter table public.org_payment_intents drop constraint if exists org_payment_intents_status_check;
alter table public.org_payment_intents
  add constraint org_payment_intents_status_check
  check (status in ('pending', 'paid', 'failed', 'test'));

-- Le serveur note, en même temps que le jeton PayTech, si la demande est en mode test.
drop function if exists public.svc_org_payment_set_token(uuid, text);
create function public.svc_org_payment_set_token(
  p_intent uuid, p_token text, p_test boolean default false
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.org_payment_intents
  set provider_token = p_token, test_mode = coalesce(p_test, false)
  where id = p_intent and status = 'pending'
$$;
revoke all on function public.svc_org_payment_set_token(uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.svc_org_payment_set_token(uuid, text, boolean) to service_role;

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
  if x.status in ('paid', 'test') then
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
  -- Mode test : rien n'est comptabilisé, le membre est prévenu.
  if x.test_mode then
    update public.org_payment_intents
    set status = 'test', provider_ref = p_provider_ref, payer_phone = p_phone
    where id = x.id;
    perform private.notify(x.user_id, 'organization',
      (select org.short_name from public.organizations org where org.id = x.organization_id)
        || ' – Paiement de test',
      format('Paiement de test réussi (%s) : il n’est pas comptabilisé, votre cotisation reste due.',
        private.format_amount(x.amount)), null);
    return 'test';
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
