-- Réclamations des membres : un membre ouvre lui-même un litige (paiement débité mais non
-- enregistré, double paiement, mauvais montant, cagnotte non reçue, autre). Le super admin
-- le traite dans Litiges ; le membre suit l'avancement depuis l'application.

alter type public.dispute_kind add value if not exists 'payout_not_received';

create or replace function public.dispute_open(
  p_group uuid, p_round uuid, p_kind public.dispute_kind, p_amount integer,
  p_method public.payment_method, p_provider_ref text, p_description text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  g public.groups := private.require_group(p_group);
  description text := btrim(coalesce(p_description, ''));
  ref text := nullif(btrim(coalesce(p_provider_ref, '')), '');
  new_id uuid;
begin
  if not exists (select 1 from public.memberships m
                 where m.group_id = g.id and m.user_id = uid and m.status in ('active', 'removed')) then
    raise exception 'Vous ne faites pas partie de ce groupe.' using errcode = '42501';
  end if;
  if p_round is not null and not exists (
    select 1 from public.rounds r where r.id = p_round and r.group_id = g.id) then
    raise exception 'Ce tour n’appartient pas à ce groupe.' using errcode = '22023';
  end if;
  if char_length(description) < 5 or char_length(description) > 1000 then
    raise exception 'Expliquez le problème en quelques mots (5 à 1 000 caractères).'
      using errcode = '22023';
  end if;
  if p_amount is null or p_amount < 0 or p_amount > 10000000 then
    raise exception 'Montant invalide.' using errcode = '22023';
  end if;
  if ref is not null and char_length(ref) > 60 then
    raise exception 'Référence trop longue.' using errcode = '22023';
  end if;
  perform private.inspect_input('Réclamation', description);
  if ref is not null then
    perform private.inspect_input('Référence', ref);
  end if;
  -- Anti-abus : au plus 5 réclamations en cours par personne.
  if (select count(*) from public.disputes
      where user_id = uid and status in ('open', 'in_progress')) >= 5 then
    raise exception 'Vous avez déjà 5 réclamations en cours : attendez leur traitement.'
      using errcode = '23505';
  end if;

  insert into public.disputes (user_id, group_id, round_id, provider_ref, method, kind,
    description, amount)
  values (uid, g.id, p_round, ref, p_method, p_kind, description, p_amount)
  returning id into new_id;
  insert into public.dispute_events (dispute_id, actor_id, text)
  values (new_id, uid, 'Réclamation ouverte par le membre : ' || left(description, 900));

  insert into public.notifications (user_id, type, title, body, link)
  select p.id, 'dispute', 'Nouvelle réclamation',
    format('%s (%s) : %s', private.full_name(uid), g.name, left(description, 200)),
    '/admin/litiges'
  from public.profiles p
  where p.global_role = 'super_admin' and not p.is_suspended and p.deleted_at is null;
  -- Cagnotte non reçue : les admins du groupe, qui ont fait l'envoi, sont prévenus aussi.
  if p_kind = 'payout_not_received' then
    perform private.notify_managers(g.id, 'dispute', 'Cagnotte signalée non reçue',
      format('%s : %s signale ne pas avoir reçu sa cagnotte. Vérifiez l’envoi.', g.name,
        private.full_name(uid)));
  end if;
  return new_id;
end;
$$;

revoke all on function public.dispute_open(uuid, uuid, public.dispute_kind, integer,
  public.payment_method, text, text) from public, anon;
grant execute on function public.dispute_open(uuid, uuid, public.dispute_kind, integer,
  public.payment_method, text, text) to authenticated;
