-- Super admin : versements (blocage), rémunération des admins, litiges, annonces.
-- Référence : tontine-pwa/src/services/mock/finance.mock.ts, dispute.mock.ts,
-- communication.mock.ts (mêmes règles, mêmes messages). Les lectures passent par les
-- tables (RLS : super admin).
--
-- Litiges : aucun écran ne permet encore au membre d'en ouvrir un. Ils sont créés
-- automatiquement par les notifications PayTech anormales (montant différent de celui
-- attendu, paiement en ligne arrivé alors que le tour était déjà payé).

-- ---------------------------------------------------------------------------
-- Versements : blocage en cas de doute
-- ---------------------------------------------------------------------------

create or replace function public.payout_block(p_round uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_super_admin();
  r public.rounds := private.require_round(p_round);
  g public.groups := private.require_group(r.group_id);
  why text := btrim(coalesce(p_reason, ''));
begin
  if r.status = 'paid_out' then
    raise exception 'Cette cagnotte a déjà été versée.' using errcode = '22023';
  end if;
  if char_length(why) < 4 then
    raise exception 'Indiquez la raison du blocage.' using errcode = '22023';
  end if;
  perform private.inspect_input('Raison du blocage', why);
  update public.rounds set payout_blocked_at = now(), payout_block_reason = left(why, 300)
  where id = r.id;
  perform private.notify_managers(g.id, 'admin', 'Versement bloqué',
    format('%s : le versement du tour %s est bloqué (%s).', g.name, r.number, why));
  perform private.audit(uid, 'payout_blocked',
    format('a bloqué le versement du tour %s — %s (%s)', r.number, g.name, why), g.id);
end;
$$;

create or replace function public.payout_unblock(p_round uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_super_admin();
  r public.rounds := private.require_round(p_round);
  g public.groups := private.require_group(r.group_id);
begin
  if r.payout_blocked_at is null then
    raise exception 'Ce versement n’est pas bloqué.' using errcode = '22023';
  end if;
  update public.rounds set payout_blocked_at = null, payout_block_reason = null where id = r.id;
  perform private.notify_managers(g.id, 'admin', 'Versement débloqué',
    format('%s : le versement du tour %s peut de nouveau être validé.', g.name, r.number));
  perform private.audit(uid, 'payout_unblocked',
    format('a débloqué le versement du tour %s — %s', r.number, g.name), g.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Rémunération facultative de l'admin d'un groupe, prise sur les revenus du groupe
-- ---------------------------------------------------------------------------

create or replace function private.earnings_balance(p_group uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(0,
    coalesce((select sum(amount) from public.platform_earnings where group_id = p_group), 0)
    - coalesce((select sum(amount) from public.admin_compensations where group_id = p_group), 0)
  )::integer
$$;

create or replace function public.admin_compensate(p_group uuid, p_amount integer, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_super_admin();
  g public.groups := private.require_group(p_group);
  balance integer := private.earnings_balance(p_group);
  note text := btrim(coalesce(p_note, ''));
begin
  if p_amount is null or p_amount < 1 then
    raise exception 'Le montant doit être un nombre entier supérieur à zéro.' using errcode = '22023';
  end if;
  if p_amount > balance then
    raise exception 'Le montant dépasse les revenus disponibles du groupe (% FCFA).', balance
      using errcode = '22023';
  end if;
  if note = '' then
    raise exception 'Indiquez le motif de cette rémunération.' using errcode = '22023';
  end if;
  perform private.inspect_input('Motif', note);
  insert into public.admin_compensations (group_id, admin_id, amount, note, paid_by)
  values (g.id, g.admin_id, p_amount, left(note, 300), uid);
  perform private.notify(g.admin_id, 'admin_compensation', 'Rémunération reçue',
    format('Le Superadmin vous a versé %s pour « %s ».', private.format_amount(p_amount), g.name),
    '/admin/groupes/' || g.id);
  perform private.audit(uid, 'admin_compensated',
    format('a versé %s à l’administrateur de « %s »', private.format_amount(p_amount), g.name), g.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Litiges
-- ---------------------------------------------------------------------------

create or replace function private.require_dispute(p_dispute uuid)
returns public.disputes
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d public.disputes;
begin
  select * into d from public.disputes where id = p_dispute;
  if not found then
    raise exception 'Ce litige est introuvable.' using errcode = 'P0002';
  end if;
  return d;
end;
$$;

create or replace function private.require_open_dispute(d public.disputes)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if d.status in ('resolved', 'rejected') then
    raise exception 'Ce litige est déjà clôturé.' using errcode = '22023';
  end if;
end;
$$;

-- Étape de suivi : historique, message au membre, journal d'audit.
create or replace function private.dispute_track(
  d public.disputes, p_actor uuid, p_text text, p_member_message text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.dispute_events (dispute_id, actor_id, text) values (d.id, p_actor, left(p_text, 1000));
  perform private.notify(d.user_id, 'dispute', 'Votre réclamation', p_member_message,
    '/groupes/' || d.group_id);
  perform private.audit(p_actor, 'dispute_updated',
    format('a traité le litige de %s : %s', private.full_name(d.user_id), lower(p_text)), d.group_id);
end;
$$;

-- Litige ouvert automatiquement (notification PayTech anormale), une fois par paiement.
create or replace function private.open_dispute(
  p public.payments, p_kind public.dispute_kind, p_amount integer, p_description text,
  p_provider_ref text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  dispute_id uuid;
  group_id uuid := (select r.group_id from public.rounds r where r.id = p.round_id);
begin
  if exists (select 1 from public.disputes d where d.payment_id = p.id and d.kind = p_kind) then
    return;
  end if;
  insert into public.disputes (user_id, group_id, round_id, payment_id, provider_ref, method,
    kind, description, amount)
  values (p.user_id, group_id, p.round_id, p.id, p_provider_ref, p.method, p_kind,
    p_description, p_amount)
  returning id into dispute_id;
  insert into public.dispute_events (dispute_id, actor_id, text)
  values (dispute_id, null, 'Ouvert automatiquement : ' || p_description);
  insert into public.notifications (user_id, type, title, body, link)
  select pr.id, 'dispute', 'Litige à traiter', p_description, '/admin/litiges'
  from public.profiles pr
  where pr.global_role = 'super_admin' and not pr.is_suspended and pr.deleted_at is null;
end;
$$;

create or replace function public.dispute_take(p_dispute uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_super_admin();
  d public.disputes := private.require_dispute(p_dispute);
begin
  if d.status <> 'open' then
    raise exception 'Ce litige est déjà pris en charge.' using errcode = '22023';
  end if;
  update public.disputes set status = 'in_progress' where id = d.id;
  perform private.dispute_track(d, uid, 'Prise en charge',
    'Votre réclamation est en cours de traitement.');
end;
$$;

-- Paiement débité mais absent de l'appli : le relevé PayTech en est la preuve.
create or replace function public.dispute_record_payment(p_dispute uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_super_admin();
  d public.disputes := private.require_dispute(p_dispute);
  proof public.provider_ledger;
  r public.rounds;
  g public.groups;
begin
  perform private.require_open_dispute(d);
  if d.kind <> 'debited_not_recorded' or d.round_id is null then
    raise exception 'Cette action concerne un paiement débité mais non enregistré.' using errcode = '22023';
  end if;
  select * into proof from public.provider_ledger where ref = d.provider_ref;
  if not found then
    raise exception 'Ce paiement est absent du relevé du service de paiement.' using errcode = '22023';
  end if;
  r := private.require_round(d.round_id);
  g := private.require_group(r.group_id);
  if private.member_status(r.id, d.user_id) = 'paid' then
    raise exception 'Ce membre est déjà enregistré comme ayant payé ce tour.' using errcode = '22023';
  end if;
  update public.payments set status = 'failed'
  where round_id = r.id and user_id = d.user_id and status in ('pending', 'late');
  insert into public.payments (round_id, user_id, amount, contribution_amount, method,
    provider_ref, status, paid_at, created_at, recorded_by)
  values (r.id, d.user_id, proof.amount, proof.amount, coalesce(d.method, 'orange_money'),
    proof.ref, 'paid', proof.at, proof.at, uid);
  perform private.refresh_round(r.id);
  update public.disputes set status = 'resolved' where id = d.id;
  perform private.dispute_track(d, uid,
    format('Paiement de %s enregistré (réf. %s)', private.format_amount(proof.amount), proof.ref),
    format('%s : votre paiement de %s est maintenant enregistré.', g.name,
      private.format_amount(proof.amount)));
end;
$$;

create or replace function public.dispute_refund(p_dispute uuid, p_amount integer, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_super_admin();
  d public.disputes := private.require_dispute(p_dispute);
  note text := btrim(coalesce(p_note, ''));
begin
  perform private.require_open_dispute(d);
  if p_amount is null or p_amount <= 0 then
    raise exception 'Montant invalide.' using errcode = '22023';
  end if;
  if p_amount > d.amount then
    raise exception 'Le remboursement ne peut pas dépasser %.', private.format_amount(d.amount)
      using errcode = '22023';
  end if;
  perform private.inspect_input('Note', note);
  -- Le paiement remboursé ne compte plus comme encaissé.
  update public.payments
  set status = 'refunded', paid_at = coalesce(paid_at, now())
  where id = d.payment_id and amount + service_fee_amount >= p_amount and status <> 'refunded'
    and not (status = 'paid' and amount <> p_amount);
  update public.disputes
  set status = 'resolved', refund_amount = p_amount, refund_validated_at = now(),
    refund_validated_by = uid
  where id = d.id;
  perform private.dispute_track(d, uid,
    format('Remboursement de %s validé%s', private.format_amount(p_amount),
      case when note <> '' then ' : ' || note else '' end),
    format('Un remboursement de %s a été validé. Vous le recevrez sur votre numéro.',
      private.format_amount(p_amount)));
  perform private.audit(uid, 'refund_validated',
    format('a validé un remboursement de %s', private.format_amount(p_amount)), d.group_id);
end;
$$;

create or replace function public.dispute_reject(p_dispute uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_super_admin();
  d public.disputes := private.require_dispute(p_dispute);
  reason text := btrim(coalesce(p_note, ''));
begin
  perform private.require_open_dispute(d);
  if reason = '' then
    raise exception 'Expliquez au membre pourquoi la réclamation est rejetée.' using errcode = '22023';
  end if;
  perform private.inspect_input('Explication', reason);
  update public.disputes set status = 'rejected' where id = d.id;
  perform private.dispute_track(d, uid, 'Rejeté : ' || reason,
    'Votre réclamation n’a pas été retenue : ' || reason);
end;
$$;

-- Confirmation PayTech (version de …_paiement_en_ligne.sql) : les anomalies ouvrent
-- désormais un litige au lieu d'être seulement journalisées.
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
    perform private.open_dispute(p, 'wrong_amount', greatest(coalesce(p_charged, 0), 0),
      format('Montant notifié par PayTech (%s) différent du montant attendu (%s).',
        private.format_amount(coalesce(p_charged, 0)),
        private.format_amount(p.amount + p.service_fee_amount)),
      p_provider_ref);
    return 'mismatch';
  end if;
  select * into r from public.rounds where id = p.round_id;
  select * into g from public.groups where id = r.group_id;
  -- Payé en ligne alors que le tour était déjà réglé (espèces) : à rembourser.
  if private.member_status(r.id, p.user_id) = 'paid' then
    update public.payments set status = 'failed', provider_ref = p_provider_ref where id = p.id;
    perform private.open_dispute(p, 'double_payment', p_charged,
      format('Paiement en ligne de %s reçu alors que le tour %s de « %s » était déjà payé.',
        private.format_amount(p_charged), r.number, g.name),
      p_provider_ref);
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

-- ---------------------------------------------------------------------------
-- Annonces : notifications ici ; les SMS sont envoyés par l'Edge Function
-- announcement-send à partir de la liste renvoyée.
-- ---------------------------------------------------------------------------

create or replace function public.svc_announcement(
  p_actor uuid, p_kind text, p_group uuid, p_title text, p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  title text := btrim(coalesce(p_title, ''));
  message text := btrim(coalesce(p_message, ''));
  group_name text;
  recipients jsonb;
begin
  if not exists (
    select 1 from public.profiles
    where id = p_actor and global_role = 'super_admin' and not is_suspended and deleted_at is null
  ) then
    raise exception 'Réservé au super administrateur.' using errcode = '42501';
  end if;
  if title = '' or message = '' then
    raise exception 'Le titre et le message de l’annonce sont obligatoires.' using errcode = '22023';
  end if;
  if char_length(title) > 120 or char_length(message) > 600 then
    raise exception 'Annonce trop longue (titre : 120 caractères, message : 600).' using errcode = '22023';
  end if;
  perform private.inspect_input('Titre de l’annonce', title);
  perform private.inspect_input('Message de l’annonce', message);
  if p_kind = 'group' then
    select name into group_name from public.groups where id = p_group;
    if group_name is null then
      raise exception 'Ce groupe n’existe pas.' using errcode = 'P0002';
    end if;
  elsif p_kind not in ('all', 'admins') then
    raise exception 'Destinataires invalides.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', pr.id, 'phone', pr.phone)), '[]'::jsonb)
  into recipients
  from public.profiles pr
  where pr.deleted_at is null and not pr.is_suspended and pr.phone is not null
    and case p_kind
      when 'admins' then pr.global_role = 'admin'
      when 'group' then exists (select 1 from public.memberships m
        where m.group_id = p_group and m.user_id = pr.id and m.status = 'active')
      else true end;

  insert into public.notifications (user_id, type, title, body, link)
  select (x ->> 'id')::uuid, 'announcement', title, message,
    case when p_kind = 'group' then '/groupes/' || p_group end
  from jsonb_array_elements(recipients) x;

  perform private.audit(p_actor, 'announcement_sent',
    format('a envoyé l’annonce « %s » à %s', title,
      case p_kind when 'group' then format('« %s »', group_name)
        when 'admins' then 'tous les administrateurs' else 'toute la plateforme' end),
    case when p_kind = 'group' then p_group end);
  return recipients;
end;
$$;

-- ---------------------------------------------------------------------------
-- Droits d'exécution
-- ---------------------------------------------------------------------------

revoke execute on all functions in schema private from public;
grant execute on function
  private.active_uid(), private.is_super_admin(), private.can_manage_group(uuid),
  private.can_view_group(uuid), private.manages_person(uuid), private.is_community_admin(uuid)
to authenticated;

do $grants$
declare
  fn text;
begin
  foreach fn in array array[
    'payout_block(uuid, text)', 'payout_unblock(uuid)', 'admin_compensate(uuid, integer, text)',
    'dispute_take(uuid)', 'dispute_record_payment(uuid)', 'dispute_refund(uuid, integer, text)',
    'dispute_reject(uuid, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
  execute 'revoke all on function public.svc_announcement(uuid, text, uuid, text, text) from public, anon, authenticated';
  execute 'grant execute on function public.svc_announcement(uuid, text, uuid, text, text) to service_role';
  execute 'revoke all on function public.svc_payment_confirm(uuid, integer, text, text) from public, anon, authenticated';
  execute 'grant execute on function public.svc_payment_confirm(uuid, integer, text, text) to service_role';
end;
$grants$;
