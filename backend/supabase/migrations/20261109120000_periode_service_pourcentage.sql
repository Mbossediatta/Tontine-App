-- Période de service de la plateforme à pourcentage (décision du 9 novembre 2026).
--
-- Le tour réservé à la plateforme (reserve_final_turn) ne coûte plus forcément une
-- cotisation entière : chaque membre y paie platform_share_percent % de sa cotisation
-- (50 % par défaut). Le pourcentage se règle dans Paramètres › Règles
-- (platformSharePercent) et s'applique aux groupes créés ensuite ; il est figé dans le
-- groupe à sa création. Les groupes déjà démarrés gardent 100 % (la règle acceptée par
-- leurs membres) ; les groupes pas encore démarrés passent au nouveau réglage.
--
-- Les tours entre membres ne changent pas. Les fonctions ci-dessous sont reprises telles
-- quelles, seul le calcul de la cotisation du tour passe par private.period_contribution.

alter table public.groups
  add column platform_share_percent smallint not null default 100
    check (platform_share_percent between 10 and 100);

comment on column public.groups.platform_share_percent is
  'Part d''une cotisation payée par chaque membre pendant la période de service de la plateforme (%), figée à la création du groupe.';

update public.platform_settings
set rules = rules || jsonb_build_object('platformSharePercent', 50);

-- Réglage actuel (Paramètres › Règles), 50 % s'il manque.
create or replace function private.platform_share_setting()
returns smallint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (s.rules ->> 'platformSharePercent')::smallint
                   from public.platform_settings s), 50::smallint);
$$;

-- Groupes pas encore démarrés : le nouveau réglage (aucun paiement n'a eu lieu).
update public.groups
set platform_share_percent = private.platform_share_setting()
where status = 'draft';

-- Nouveau groupe : le réglage du moment, figé pour toute sa vie.
create or replace function private.set_platform_share()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.platform_share_percent := private.platform_share_setting();
  return new;
end;
$$;

create trigger groups_set_platform_share
  before insert on public.groups
  for each row execute function private.set_platform_share();

-- Cotisation d'une période pour une part : entière entre membres, réduite pendant la
-- période de service de la plateforme (arrondie au franc).
create or replace function private.period_contribution(g public.groups, r public.rounds)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when r.recipient_type = 'platform'
      then round(g.contribution_amount * g.platform_share_percent / 100.0)::integer
    else g.contribution_amount
  end;
$$;


CREATE OR REPLACE FUNCTION private.round_total(p_round uuid, p_user uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    private.period_contribution(g, r)::bigint * g.turn_length
      * (select count(*) from public.memberships m
         where m.group_id = g.id and m.user_id = p_user and m.status = 'active')
    + coalesce((select sum(pe.amount) from public.penalties pe
                where pe.round_id = r.id and pe.user_id = p_user), 0)
  from public.rounds r join public.groups g on g.id = r.group_id
  where r.id = p_round
$function$;

CREATE OR REPLACE FUNCTION private.round_expected(p_round uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when r.status = 'upcoming' then 0 else
    private.period_contribution(g, r)::bigint
      * g.turn_length
      * (select count(*) from public.memberships m where m.group_id = g.id and m.status = 'active')
    + g.membership_fee_amount::bigint * (
        select count(distinct m.user_id) from public.memberships m
        where m.group_id = g.id and m.status = 'active'
          and not exists (
            select 1 from public.platform_earnings e
            where e.group_id = g.id and e.user_id = m.user_id and e.kind = 'membership_fee'
          )
      )
    + coalesce((select sum(pe.amount) from public.penalties pe where pe.round_id = r.id), 0)
  end
  from public.rounds r join public.groups g on g.id = r.group_id
  where r.id = p_round
$function$;

CREATE OR REPLACE FUNCTION private.installment(r rounds, g groups, p_user uuid, p_periods integer)
 RETURNS TABLE(contribution integer, fee integer, penalty integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  shares integer := (select count(*) from public.memberships
    where group_id = g.id and user_id = p_user and status = 'active');
  per_period integer := private.period_contribution(g, r) * shares;
  paid_contribution integer := coalesce((select sum(p.contribution_amount) from public.payments p
    where p.round_id = r.id and p.user_id = p_user and p.status = 'paid'), 0);
  paid_penalty integer := coalesce((select sum(p.late_penalty_amount) from public.payments p
    where p.round_id = r.id and p.user_id = p_user and p.status = 'paid'), 0);
  rest integer := greatest(0, per_period * g.turn_length - paid_contribution);
begin
  if p_periods is not null and (p_periods < 1 or p_periods > g.turn_length) then
    raise exception 'Nombre de jours ou de périodes invalide.' using errcode = '22023';
  end if;
  contribution := case when p_periods is null then rest else least(rest, per_period * p_periods) end;
  fee := case when exists (
      select 1 from public.platform_earnings e
      where e.group_id = g.id and e.user_id = p_user and e.kind = 'membership_fee'
    ) then 0 else g.membership_fee_amount end;
  -- La pénalité part avec le versement qui termine le tour.
  penalty := case when contribution >= rest then greatest(0, coalesce((select sum(amount)
    from public.penalties where round_id = r.id and user_id = p_user), 0) - paid_penalty) else 0 end;
  if contribution + fee + penalty <= 0 then
    raise exception 'Vous avez déjà payé ce tour.' using errcode = '23505';
  end if;
  return next;
end;
$function$;

CREATE OR REPLACE FUNCTION public.round_payout(p_round uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      greatest(0, private.period_contribution(g, r) * g.turn_length * u.shares
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
$function$;

CREATE OR REPLACE FUNCTION private.create_rounds(g groups)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  shares integer := private.active_share_count(g.id);
  batches integer := ceil(shares::numeric / greatest(1, g.shares_per_round))::integer;
  total integer := batches + case when g.reserve_final_turn then 1 else 0 end;
  pot integer := g.contribution_amount * g.turn_length * shares;
  n integer;
  open_d date;
  new_round uuid;
begin
  for n in 1..total loop
    open_d := private.add_periods(g.start_date, g.frequency, (n - 1) * g.turn_length);
    insert into public.rounds (group_id, cycle, number, open_date, due_date, recipient_type,
      pot_amount, status)
    values (g.id, g.current_cycle, n, open_d,
      private.round_due_date(open_d, g.frequency, g.payment_due_day, g.turn_length),
      case when n > batches then 'platform' else 'members' end::public.recipient_type,
      -- Période de service : la part réglée de la cotisation (platform_share_percent).
      case when n > batches
        then round(g.contribution_amount * g.platform_share_percent / 100.0)::integer
          * g.turn_length * shares
        else pot end,
      case when n = 1 then 'open' else 'upcoming' end::public.round_status)
    returning id into new_round;
    if n <= batches then
      insert into public.round_beneficiaries (round_id, membership_id)
      select new_round, m.id from public.memberships m
      where m.group_id = g.id and m.status = 'active'
        and m.payout_order > (n - 1) * g.shares_per_round
        and m.payout_order <= n * g.shares_per_round;
    end if;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.settings_update(p_section text, p_values jsonb, p_new_secret text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  uid uuid := private.require_super_admin();
  s public.platform_settings;
  secret text := nullif(btrim(coalesce(p_new_secret, '')), '');
  section_value jsonb;
  min_amount numeric;
  secret_id uuid;
begin
  select * into s from public.platform_settings for update;
  if p_values is null or jsonb_typeof(p_values) <> 'object' then
    raise exception 'Les paramètres transmis sont invalides.' using errcode = '22023';
  end if;
  if secret is not null and p_section <> 'payment' then
    raise exception 'La clé Orange SMS se règle dans les secrets du serveur (plusieurs identifiants sont nécessaires).'
      using errcode = '22023';
  end if;

  case p_section
    when 'payment' then
      if p_values ->> 'mode' not in ('test', 'prod') then
        raise exception 'Mode de paiement : test ou prod.' using errcode = '22023';
      end if;
      section_value := jsonb_build_object(
        'provider', private.require_text(p_values, 'provider', 'Prestataire', 2, 40),
        'publicKey', private.require_text(p_values, 'publicKey', 'Clé API', 0, 200),
        'secretKeyHint', s.payment -> 'secretKeyHint',
        'feePercent', private.require_number(p_values, 'feePercent', 'Frais de paiement (%)', 0, 10),
        'mode', p_values ->> 'mode');
      if secret is not null then
        if char_length(secret) < 8 then
          raise exception 'Cette clé paraît trop courte.' using errcode = '22023';
        end if;
        select id into secret_id from vault.secrets where name = 'paytech_api_secret';
        if secret_id is null then
          perform vault.create_secret(secret, 'paytech_api_secret', 'Clé secrète PayTech (API_SECRET)');
        else
          perform vault.update_secret(secret_id, secret);
        end if;
        section_value := section_value
          || jsonb_build_object('secretKeyHint', '•••• ' || right(secret, 4));
        perform private.audit(uid, 'settings_updated',
          'a remplacé la clé secrète du service de paiement');
      end if;
      update public.platform_settings set payment = section_value, updated_by = uid where id;
    when 'rules' then
      min_amount := private.require_number(p_values, 'minContribution', 'Cotisation minimale', 100, 1000000);
      section_value := jsonb_build_object(
        'graceDays', private.require_number(p_values, 'graceDays', 'Délai de grâce (jours)', 0, 30),
        'defaultLatePenalty',
          private.require_number(p_values, 'defaultLatePenalty', 'Pénalité par défaut', 0, 1000000),
        'minContribution', min_amount,
        'maxContribution',
          private.require_number(p_values, 'maxContribution', 'Cotisation maximale', min_amount, 10000000),
        'maxMembers', private.require_number(p_values, 'maxMembers', 'Parts par groupe', 2, 500),
        'platformSharePercent', private.require_number(p_values, 'platformSharePercent',
          'Période de service : part d’une cotisation (%)', 10, 100));
      update public.platform_settings set rules = section_value, updated_by = uid where id;
    when 'security' then
      section_value := jsonb_build_object(
        'otpValidityMinutes',
          private.require_number(p_values, 'otpValidityMinutes', 'Validité du code SMS (minutes)', 2, 30),
        'maxPinAttempts', private.require_number(p_values, 'maxPinAttempts', 'Essais du PIN', 3, 10),
        'inactivityLockMinutes',
          private.require_number(p_values, 'inactivityLockMinutes', 'Verrouillage (minutes)', 1, 120));
      update public.platform_settings set security = section_value, updated_by = uid where id;
    when 'sms' then
      section_value := jsonb_build_object(
        'provider', private.require_text(p_values, 'provider', 'Fournisseur', 2, 40),
        'senderName', private.require_text(p_values, 'senderName', 'Nom d’expéditeur', 2, 11),
        'apiKeyHint', s.sms -> 'apiKeyHint',
        'costPerSms', private.require_number(p_values, 'costPerSms', 'Coût d’un SMS', 0, 1000));
      update public.platform_settings set sms = section_value, updated_by = uid where id;
    when 'app' then
      section_value := jsonb_build_object(
        'name', private.require_text(p_values, 'name', 'Nom de l’application', 2, 60),
        'supportPhone', private.checked_phone_format(p_values ->> 'supportPhone'),
        'termsText', private.require_text(p_values, 'termsText', 'Conditions', 10, 5000),
        'privacyText', private.require_text(p_values, 'privacyText', 'Confidentialité', 10, 5000));
      update public.platform_settings set app = section_value, updated_by = uid where id;
    when 'templates' then
      section_value := jsonb_build_object(
        'reminder', private.require_text(p_values, 'reminder', 'Modèle « rappel »', 10, 320),
        'late', private.require_text(p_values, 'late', 'Modèle « retard »', 10, 320),
        'payment', private.require_text(p_values, 'payment', 'Modèle « paiement »', 10, 320),
        'payout', private.require_text(p_values, 'payout', 'Modèle « versement »', 10, 320));
      update public.platform_settings
      set templates = jsonb_set(s.templates, '{fr}', section_value), updated_by = uid where id;
    else
      raise exception 'Section de paramètres inconnue.' using errcode = '22023';
  end case;

  perform private.audit(uid, 'settings_updated', format('a modifié les paramètres « %s »', p_section));
end;
$function$;
