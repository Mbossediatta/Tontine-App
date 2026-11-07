-- 1. Notifications dans la langue du membre : « paiement reçu » et « cagnotte envoyée » sont
--    écrites avec les modèles (Paramètres), en wolof pour un membre wolophone ; les modèles
--    wolof deviennent modifiables (settings_update_templates).
-- 2. Seconde validation : une cagnotte de 300 000 FCFA ou plus (réellement collectée) n'est
--    versée qu'après validation du super admin ; « Reverser » d'un admin devient une demande.
-- 3. Remboursement d'une dette en ligne (Wave, Orange Money) : un paiement PayTech lié à la
--    dette, qui la règle à sa confirmation.

-- ---------------------------------------------------------------------------
-- 1. Modèles de messages en français et en wolof
-- ---------------------------------------------------------------------------

create or replace function public.settings_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.platform_settings;
begin
  perform private.require_super_admin();
  select * into s from public.platform_settings;
  return jsonb_build_object(
    'payment', s.payment,
    'rules', s.rules,
    'security', s.security,
    'sms', s.sms,
    'app', s.app,
    'templates', coalesce(s.templates -> 'fr', '{}'::jsonb),
    'templatesWo', coalesce(s.templates -> 'wo', '{}'::jsonb)
  );
end;
$$;

-- Modèles d'une langue (« fr » ou « wo »), par le super admin.
create or replace function public.settings_update_templates(p_language text, p_values jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_super_admin();
  section_value jsonb;
begin
  if p_language not in ('fr', 'wo') then
    raise exception 'Langue inconnue.' using errcode = '22023';
  end if;
  section_value := jsonb_build_object(
    'reminder', private.require_text(p_values, 'reminder', 'Modèle « rappel »', 10, 320),
    'late', private.require_text(p_values, 'late', 'Modèle « retard »', 10, 320),
    'payment', private.require_text(p_values, 'payment', 'Modèle « paiement »', 10, 320),
    'payout', private.require_text(p_values, 'payout', 'Modèle « versement »', 10, 320));
  update public.platform_settings
  set templates = jsonb_set(templates, array[p_language], section_value), updated_by = uid
  where true;
  perform private.audit(uid, 'settings_updated',
    format('a modifié les modèles de messages (%s)',
      case p_language when 'wo' then 'wolof' else 'français' end));
end;
$$;

revoke all on function public.settings_update_templates(text, jsonb) from public, anon;
grant execute on function public.settings_update_templates(text, jsonb) to authenticated;

-- Notification écrite avec un modèle, dans la langue du membre ; `p_extra` est ajouté à la fin.
create or replace function private.notify_template(
  p_user uuid, p_type text, p_title text, p_key text, p_group text, p_amount integer,
  p_extra text, p_link text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, type, title, body, link)
  select p.id, p_type, p_title,
    left(private.render_template(p_key, p.language::text, jsonb_build_object(
      'prenom', p.first_name, 'montant', private.format_amount(p_amount), 'groupe', p_group,
      'date', to_char(now() at time zone 'Africa/Dakar', 'DD/MM/YYYY'))) || coalesce(p_extra, ''),
      1000),
    p_link
  from public.profiles p where p.id = p_user
$$;

-- ---------------------------------------------------------------------------
-- 2. Seconde validation des grosses cagnottes
-- ---------------------------------------------------------------------------

alter table public.rounds
  add column payout_requested_at timestamptz,
  add column payout_requested_by uuid references public.profiles (id) on delete set null;

-- Seuil de la seconde validation (Paramètres → Règles, 300 000 FCFA par défaut).
create or replace function private.payout_approval_threshold()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((s.rules ->> 'payoutApprovalThreshold')::integer, 300000)
  from public.platform_settings s
$$;

-- ---------------------------------------------------------------------------
-- 3. Remboursement d'une dette en ligne
-- ---------------------------------------------------------------------------

alter type public.debt_settlement add value if not exists 'online';
alter table public.payments
  add column debt_id uuid references public.debts (id) on delete set null;

-- Paiement en ligne d'une dette : prépare la ligne « pending » (montant de la dette, frais
-- PayTech en plus). Même réponse que svc_payment_prepare.
create or replace function public.svc_debt_payment_prepare(
  p_user uuid, p_debt uuid, p_method public.payment_method
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.debts;
  r public.rounds;
  g public.groups;
  amount_due integer;
  service_fee integer;
  fee_percent numeric := coalesce(
    (select (s.payment ->> 'feePercent')::numeric from public.platform_settings s), 0);
  pay_mode text := coalesce(
    (select s.payment ->> 'mode' from public.platform_settings s), 'test');
  saved_id uuid;
begin
  if p_method = 'cash' then
    raise exception 'Choisissez Wave, Orange Money ou Free Money.' using errcode = '22023';
  end if;
  select * into d from public.debts where id = p_debt for update;
  if not found or d.user_id <> p_user then
    raise exception 'Cette dette est introuvable.' using errcode = 'P0002';
  end if;
  if d.status <> 'open' then
    raise exception 'Cette dette est déjà réglée.' using errcode = '23505';
  end if;
  select * into r from public.rounds where id = d.round_id;
  select * into g from public.groups where id = d.group_id;
  amount_due := d.amount + d.penalty_amount;
  service_fee := ceil(amount_due * fee_percent / 100)::integer;

  -- Un essai en cours sur ce tour est réutilisé (un seul essai à la fois par tour).
  select id into saved_id from public.payments
  where round_id = r.id and user_id = p_user and status in ('pending', 'late') for update;
  if saved_id is not null then
    update public.payments
    set amount = amount_due, contribution_amount = d.amount, membership_fee_amount = 0,
      late_penalty_amount = d.penalty_amount, service_fee_amount = service_fee, method = p_method,
      status = 'pending', provider_token = null, created_at = now(), debt_id = d.id
    where id = saved_id;
  else
    insert into public.payments (round_id, user_id, amount, contribution_amount,
      membership_fee_amount, late_penalty_amount, service_fee_amount, method, status, debt_id)
    values (r.id, p_user, amount_due, d.amount, 0, d.penalty_amount, service_fee, p_method,
      'pending', d.id)
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

revoke all on function public.svc_debt_payment_prepare(uuid, uuid, public.payment_method)
  from public, anon, authenticated;
grant execute on function public.svc_debt_payment_prepare(uuid, uuid, public.payment_method)
  to service_role;

-- Paiement confirmé (notification PayTech vérifiée, ou simulation locale). Comme avant, plus :
-- notification « paiement reçu » dans la langue du membre, et règlement d'une dette payée
-- en ligne.
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
  d public.debts;
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
  if p.debt_id is not null then
    select * into d from public.debts where id = p.debt_id for update;
  end if;
  -- Payé en ligne alors que le tour (ou la dette) était déjà réglé : à rembourser.
  if (p.debt_id is null and private.member_status(r.id, p.user_id) = 'paid')
    or (p.debt_id is not null and d.status <> 'open') then
    update public.payments set status = 'failed', provider_ref = p_provider_ref where id = p.id;
    perform private.open_dispute(p, 'double_payment', p_charged,
      format('Paiement en ligne de %s reçu alors que %s de « %s » était déjà réglé.',
        private.format_amount(p_charged),
        case when p.debt_id is null then 'le tour ' || r.number else 'l’impayé du tour ' || r.number end,
        g.name),
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

  if p.debt_id is not null then
    update public.debts set status = 'settled', settled_via = 'online', settled_at = now()
    where id = d.id;
    perform private.notify(p.user_id, 'debt', 'Dette remboursée',
      format('%s : votre remboursement de %s (tour %s) est bien reçu. Merci !', g.name,
        private.format_amount(p.amount), r.number),
      '/groupes/' || g.id);
    perform private.notify_managers(g.id, 'debt', 'Dette remboursée en ligne',
      format('%s : %s a remboursé %s (impayé du tour %s) : à reverser aux bénéficiaires de ce tour.',
        g.name, private.full_name(p.user_id), private.format_amount(d.amount), r.number));
    return 'ok';
  end if;

  perform private.notify_template(p.user_id, 'payment', 'Paiement reçu', 'payment', g.name,
    p.amount, format(' (tour %s)', r.number), '/groupes/' || g.id);
  perform private.notify_managers(g.id, 'payment', 'Paiement reçu',
    format('%s a payé %s.', private.full_name(p.user_id), private.format_amount(p.amount)));
  perform private.refresh_round(r.id);
  return 'ok';
end;
$$;

-- Espèces reçues par un gestionnaire (…_versements.sql), avec la notification du membre
-- dans sa langue.
create or replace function public.payment_record_cash(p_round uuid, p_user uuid, p_periods integer default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.rounds := private.require_round(p_round);
  g public.groups := private.require_group(r.group_id);
  uid uuid := private.require_manage(g);
  part record;
  total integer;
  payment_id uuid;
begin
  perform private.assert_group_open(g);
  if r.status <> 'open' then
    raise exception 'Ce tour n’accepte plus de paiement.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.memberships
                 where group_id = g.id and user_id = p_user and status = 'active') then
    raise exception 'Cette personne n’a pas de part dans le groupe.' using errcode = '22023';
  end if;
  if private.member_status(r.id, p_user) = 'paid' then
    raise exception 'Ce membre a déjà payé.' using errcode = '22023';
  end if;
  select * into part from private.installment(r, g, p_user, p_periods);
  total := part.contribution + part.fee + part.penalty;

  update public.payments set status = 'failed'
  where round_id = r.id and user_id = p_user and status in ('pending', 'late');
  insert into public.payments (round_id, user_id, amount, contribution_amount,
    membership_fee_amount, late_penalty_amount, method, status, paid_at, recorded_by)
  values (r.id, p_user, total, part.contribution, part.fee, part.penalty,
    'cash', 'paid', now(), uid)
  returning id into payment_id;
  insert into public.platform_earnings (group_id, kind, amount, payment_id, round_id, user_id)
  select g.id, e.kind::public.earning_kind, e.amount, payment_id, r.id, p_user
  from (values ('membership_fee', part.fee), ('late_penalty', part.penalty)) e(kind, amount)
  where e.amount > 0;

  perform private.audit(uid, 'cash_recorded',
    format('a enregistré %s en espèces de %s — %s',
      private.format_amount(total), private.full_name(p_user), g.name),
    g.id);
  perform private.notify_template(p_user, 'payment', 'Paiement en espèces enregistré', 'payment',
    g.name, total, format(' (tour %s, espèces)', r.number), '/groupes/' || g.id);
  perform private.notify_managers(g.id, 'payment', 'Paiement reçu',
    format('%s a payé %s en espèces.', private.full_name(p_user), private.format_amount(total)));
  perform private.refresh_round(r.id);
end;
$$;

-- Envoi de la cagnotte noté par l'admin (…_versement_suivi.sql), avec l'avis de versement
-- dans la langue du bénéficiaire.
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
  via text := case p_method when 'wave' then 'Wave' else 'Orange Money' end;
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

  perform private.notify_template(p_user, 'payout', 'Cagnotte envoyée', 'payout', g.name, total,
    format(' (%s, réf. %s)', via, ref), '/groupes/' || g.id);
  perform private.audit(uid, 'payout_sent',
    format('a envoyé %s à %s par %s (réf. %s) — tour %s de « %s »',
      private.format_amount(total), private.full_name(p_user), via, ref, r.number, g.name),
    g.id);
end;
$$;

-- Versement de la cagnotte (…_retards_dettes.sql) avec la seconde validation : à partir du
-- seuil, un admin du groupe ne fait qu'une demande, le super admin valide. Renvoie « paid »
-- ou « pending_approval ».
drop function public.round_payout(uuid);
create function public.round_payout(p_round uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.rounds := private.require_round(p_round);
  g public.groups := private.require_group(r.group_id);
  uid uuid := private.require_manage(g);
  everyone_paid boolean;
  collected integer;
  recipients integer;
  share integer;
  debtor record;
  next_round public.rounds;
begin
  if r.recipient_type = 'platform' and not private.is_super_admin() then
    raise exception 'Réservé au super administrateur.' using errcode = '42501';
  end if;
  perform private.assert_group_open(g);
  if r.payout_blocked_at is not null then
    raise exception 'Versement bloqué par l’administration de la plateforme : %.',
      coalesce(r.payout_block_reason, 'vérification en cours') using errcode = '22023';
  end if;
  if r.status = 'paid_out' then
    raise exception 'Cette cagnotte a déjà été reversée.' using errcode = '22023';
  end if;
  everyone_paid := private.round_paid_shares(r.id) >= private.active_share_count(g.id);
  if r.status = 'upcoming' or (not everyone_paid and private.round_deadline(r.id) > now()) then
    raise exception 'Tous les membres doivent avoir payé, ou l’heure limite doit être passée, avant le reversement.'
      using errcode = '22023';
  end if;
  if r.recipient_type = 'members' and exists (
    select 1 from public.round_beneficiaries b
    join public.memberships m on m.id = b.membership_id
    join public.profiles p on p.id = m.user_id
    where b.round_id = r.id and p.payout_phone is null
  ) then
    raise exception 'Un bénéficiaire n’a pas renseigné de numéro de reversement.' using errcode = '22023';
  end if;

  collected := coalesce((select sum(p.contribution_amount) from public.payments p
                         where p.round_id = r.id and p.status = 'paid'), 0);

  -- Seconde validation : grosse cagnotte, l'admin du groupe demande, le super admin valide.
  if r.recipient_type = 'members' and collected >= private.payout_approval_threshold()
    and not private.is_super_admin() then
    if r.payout_requested_at is null then
      update public.rounds set payout_requested_at = now(), payout_requested_by = uid
      where id = r.id;
      insert into public.notifications (user_id, type, title, body, link)
      select p.id, 'payout_approval', 'Versement à valider',
        format('%s : cagnotte de %s (tour %s) à valider avant le versement.', g.name,
          private.format_amount(collected), r.number),
        '/admin/versements'
      from public.profiles p
      where p.global_role = 'super_admin' and not p.is_suspended and p.deleted_at is null;
      perform private.audit(uid, 'payout_validated',
        format('a demandé la validation du versement du tour %s (%s) — %s', r.number,
          private.format_amount(collected), g.name), g.id);
    end if;
    return 'pending_approval';
  end if;

  -- Impayés : chaque membre qui n'a pas tout versé doit le reste (cotisation et pénalité).
  for debtor in
    select u.user_id,
      greatest(0, g.contribution_amount * g.turn_length * u.shares
        - coalesce((select sum(p.contribution_amount) from public.payments p
                    where p.round_id = r.id and p.user_id = u.user_id and p.status = 'paid'), 0))
        as contribution_left,
      greatest(0, coalesce((select sum(pe.amount) from public.penalties pe
                            where pe.round_id = r.id and pe.user_id = u.user_id), 0)
        - coalesce((select sum(p.late_penalty_amount) from public.payments p
                    where p.round_id = r.id and p.user_id = u.user_id and p.status = 'paid'), 0))
        as penalty_left
    from (select user_id, count(*) as shares from public.memberships
          where group_id = g.id and status = 'active' group by user_id) u
  loop
    if debtor.contribution_left + debtor.penalty_left > 0 then
      insert into public.debts (group_id, round_id, user_id, amount, penalty_amount)
      values (g.id, r.id, debtor.user_id, debtor.contribution_left, debtor.penalty_left)
      on conflict (round_id, user_id) do nothing;
      perform private.notify(debtor.user_id, 'debt', 'Cotisation impayée',
        format('%s : la cagnotte du tour %s a été versée sans votre cotisation. Vous devez %s ; remboursez-la dans l’application, sinon ce montant sera retenu sur votre cagnotte.',
          g.name, r.number,
          private.format_amount((debtor.contribution_left + debtor.penalty_left)::integer)),
        '/groupes/' || g.id);
    end if;
  end loop;

  update public.rounds
  set status = 'paid_out', paid_out_at = now(), payout_validated_by = uid
  where id = r.id;

  if r.recipient_type = 'platform' then
    insert into public.platform_earnings (group_id, kind, amount, round_id)
    select g.id, 'reserved_turn', collected, r.id where collected > 0;
  else
    select count(*) into recipients from public.round_beneficiaries where round_id = r.id;
    share := collected / greatest(1, recipients);
    update public.round_beneficiaries b
    set amount = share + case when ranked.place <= collected - share * recipients then 1 else 0 end
    from (
      select b2.membership_id, row_number() over (order by m.payout_order) as place
      from public.round_beneficiaries b2 join public.memberships m on m.id = b2.membership_id
      where b2.round_id = r.id
    ) ranked
    where b.round_id = r.id and b.membership_id = ranked.membership_id;

    for debtor in
      select m.user_id, min(b.membership_id::text)::uuid as part,
        private.open_debt(g.id, m.user_id) as owed
      from public.round_beneficiaries b join public.memberships m on m.id = b.membership_id
      where b.round_id = r.id
      group by m.user_id
    loop
      if debtor.owed > 0 then
        update public.round_beneficiaries
        set withheld = least(amount, debtor.owed), amount = amount - least(amount, debtor.owed)
        where round_id = r.id and membership_id = debtor.part;
        insert into public.platform_earnings (group_id, kind, amount, round_id, user_id)
        select g.id, 'late_penalty', sum(d.penalty_amount), r.id, debtor.user_id
        from public.debts d
        where d.group_id = g.id and d.user_id = debtor.user_id and d.status = 'open'
        having sum(d.penalty_amount) > 0;
        update public.debts
        set status = 'settled', settled_via = 'withheld', settled_round_id = r.id,
          settled_by = uid, settled_at = now()
        where group_id = g.id and user_id = debtor.user_id and status = 'open';
        perform private.notify_managers(g.id, 'debt', 'Dette retenue',
          format('%s : %s retenus sur la cagnotte de %s (tour %s) pour rembourser ses impayés : à reverser aux bénéficiaires des tours concernés.',
            g.name, private.format_amount(debtor.owed), private.full_name(debtor.user_id), r.number));
      end if;
    end loop;

    -- La cagnotte est validée ; l'argent part ensuite (Cagnottes à envoyer).
    insert into public.notifications (user_id, type, title, body, link)
    select m.user_id, 'payout', 'Cagnotte validée',
      format('%s : votre cagnotte de %s est validée, elle va vous être envoyée%s.', g.name,
        private.format_amount(sum(b.amount)::integer),
        case when sum(b.withheld) > 0
          then format(' (%s retenus pour vos impayés)', private.format_amount(sum(b.withheld)::integer))
          else '' end),
      '/groupes/' || g.id
    from public.round_beneficiaries b join public.memberships m on m.id = b.membership_id
    where b.round_id = r.id
    group by m.user_id;
  end if;

  perform private.audit(uid, 'payout_validated',
    format('a validé le versement du tour %s — %s%s', r.number, g.name,
      case when everyone_paid then '' else ' (avec des impayés passés en dettes)' end), g.id);

  select * into next_round from public.rounds
  where group_id = g.id and cycle = r.cycle and number = r.number + 1;
  if not found then
    update public.groups set status = 'finished' where id = g.id;
    perform private.notify_managers(g.id, 'cycle_finished', 'Cycle terminé',
      format('%s : tous les membres ont reçu la cagnotte. Vous pouvez relancer un nouveau cycle.', g.name));
    return 'paid';
  end if;
  update public.rounds set status = 'open' where id = next_round.id;
  insert into public.notifications (user_id, type, title, body, link)
  select distinct m.user_id, 'beneficiary', 'Nouveau tour ouvert',
    format('%s : votre part est bénéficiaire au tour %s.', g.name, next_round.number),
    '/groupes/' || g.id
  from public.round_beneficiaries b join public.memberships m on m.id = b.membership_id
  where b.round_id = next_round.id;
  return 'paid';
end;
$$;

revoke all on function public.round_payout(uuid) from public, anon;
grant execute on function public.round_payout(uuid) to authenticated;
