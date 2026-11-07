-- Préparation de l'envoi automatique des cagnottes (Edge Function payout-send). Le transfert
-- lui-même se branchera dans functions/_shared/paytech-transfer.ts avec la documentation de
-- PayTech ; ces deux fonctions encadrent l'envoi avec les mêmes règles que l'envoi manuel.

-- Avant l'envoi : droits de l'admin, cagnotte validée, pas encore envoyée ; montant et numéro.
create or replace function public.svc_payout_transfer_prepare(p_actor uuid, p_round uuid, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.rounds;
  g public.groups;
  total integer;
  beneficiary public.profiles;
begin
  -- Les règles d'accès (can_manage_group) lisent l'utilisateur de la requête : c'est l'admin.
  perform set_config('request.jwt.claims', json_build_object('sub', p_actor)::text, true);
  r := private.require_round(p_round);
  g := private.require_group(r.group_id);
  perform private.require_manage(g);
  if r.status <> 'paid_out' or r.recipient_type <> 'members' then
    raise exception 'Validez d’abord le versement de la cagnotte.' using errcode = '22023';
  end if;
  select sum(b.amount) into total
  from public.round_beneficiaries b join public.memberships m on m.id = b.membership_id
  where b.round_id = r.id and m.user_id = p_user;
  if total is null then
    raise exception 'Cette personne n’est pas bénéficiaire de ce tour.' using errcode = '22023';
  end if;
  if exists (select 1 from public.round_beneficiaries b join public.memberships m on m.id = b.membership_id
             where b.round_id = r.id and m.user_id = p_user and b.sent_at is not null) then
    raise exception 'L’envoi de cette cagnotte est déjà enregistré.' using errcode = '23505';
  end if;
  select * into beneficiary from public.profiles where id = p_user;
  if beneficiary.payout_phone is null then
    raise exception 'Le bénéficiaire n’a pas renseigné de numéro de reversement.' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'amount', total,
    'phone', beneficiary.payout_phone,
    'method', coalesce(beneficiary.payout_method::text, 'wave'),
    'groupName', g.name,
    'roundNumber', r.number
  );
end;
$$;

-- Après un transfert réussi : noté comme un envoi (référence PayTech), au nom de l'admin.
create or replace function public.svc_payout_transfer_done(
  p_actor uuid, p_round uuid, p_user uuid, p_method public.payout_method, p_ref text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_actor)::text, true);
  perform public.payout_mark_sent(p_round, p_user, p_method, p_ref);
end;
$$;

do $grants$
declare
  fn text;
begin
  foreach fn in array array[
    'svc_payout_transfer_prepare(uuid, uuid, uuid)',
    'svc_payout_transfer_done(uuid, uuid, uuid, public.payout_method, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end;
$grants$;
