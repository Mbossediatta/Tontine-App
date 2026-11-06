-- Versement réel de la cagnotte. « Reverser la cagnotte » (round_payout) valide le montant ;
-- l'argent part ensuite par Wave ou Orange Money depuis le téléphone de l'admin. On suit cet
-- envoi : l'admin note « argent envoyé » avec la référence de la transaction, le bénéficiaire
-- confirme la réception (sinon il ouvre une réclamation). Un envoi automatique (API de
-- transfert) pourra remplacer la saisie de l'admin sans changer ce suivi.

alter type public.audit_action add value if not exists 'payout_sent';

alter table public.round_beneficiaries
  add column sent_at timestamptz,
  add column sent_by uuid references public.profiles (id) on delete set null,
  add column sent_method public.payout_method,
  add column sent_ref text check (char_length(btrim(sent_ref)) between 3 and 60),
  add column received_at timestamptz,
  add constraint round_beneficiaries_sent check (
    (sent_at is null) = (sent_method is null) and (sent_at is null) = (sent_ref is null)
  ),
  add constraint round_beneficiaries_received check (received_at is null or sent_at is not null);

-- L'admin a envoyé la cagnotte de `p_user` pour ce tour (toutes ses parts).
create or replace function public.payout_mark_sent(
  p_round uuid, p_user uuid, p_method public.payout_method, p_ref text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.rounds := private.require_round(p_round);
  g public.groups := private.require_group(r.group_id);
  uid uuid := private.require_manage(g);
  ref text := btrim(coalesce(p_ref, ''));
  total integer;
begin
  if r.status <> 'paid_out' or r.recipient_type <> 'members' then
    raise exception 'Validez d’abord le versement de la cagnotte.' using errcode = '22023';
  end if;
  if char_length(ref) < 3 or char_length(ref) > 60 then
    raise exception 'Indiquez la référence de la transaction (Wave ou Orange Money).'
      using errcode = '22023';
  end if;
  perform private.inspect_input('Référence', ref);
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

  update public.round_beneficiaries b
  set sent_at = now(), sent_by = uid, sent_method = p_method, sent_ref = ref
  from public.memberships m
  where m.id = b.membership_id and b.round_id = r.id and m.user_id = p_user;

  perform private.notify(p_user, 'payout', 'Cagnotte envoyée',
    format('%s : %s vous ont été envoyés par %s (réf. %s). Confirmez la réception dans l’application.',
      g.name, private.format_amount(total),
      case p_method when 'wave' then 'Wave' else 'Orange Money' end, ref),
    '/groupes/' || g.id);
  perform private.audit(uid, 'payout_sent',
    format('a envoyé %s à %s par %s (réf. %s) — tour %s de « %s »',
      private.format_amount(total), private.full_name(p_user),
      case p_method when 'wave' then 'Wave' else 'Orange Money' end, ref, r.number, g.name),
    g.id);
end;
$$;

-- Le bénéficiaire confirme avoir reçu l'argent.
create or replace function public.payout_confirm_received(p_round uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  r public.rounds := private.require_round(p_round);
  g public.groups := private.require_group(r.group_id);
begin
  update public.round_beneficiaries b
  set received_at = now()
  from public.memberships m
  where m.id = b.membership_id and b.round_id = r.id and m.user_id = uid
    and b.sent_at is not null and b.received_at is null;
  if not found then
    raise exception 'Aucun envoi à confirmer pour ce tour.' using errcode = '22023';
  end if;
  perform private.notify_managers(g.id, 'payout', 'Cagnotte reçue',
    format('%s : %s confirme avoir reçu sa cagnotte du tour %s.', g.name,
      private.full_name(uid), r.number));
end;
$$;

do $grants$
declare
  fn text;
begin
  foreach fn in array array[
    'payout_mark_sent(uuid, uuid, public.payout_method, text)', 'payout_confirm_received(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end;
$grants$;
