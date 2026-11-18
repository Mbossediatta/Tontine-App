-- Denthie (« garderie ») : épargne collective, décidée le 18 novembre 2026.
--
-- À la création, l'admin choisit Tontine ou Denthie. Dans un Denthie :
-- - chaque part cotise le montant fixé à chaque période du rythme (jour, semaine, quinzaine,
--   mois) ; personne ne touche rien en cours de route, l'argent reste dans la caisse ;
-- - la durée n'est pas fixée à la création : les périodes s'enchaînent jusqu'à la date de
--   répartition, que l'admin fixe (ou change) plus tard ; les membres sont prévenus ;
-- - une période se clôt à son heure limite (tâche planifiée) : qui n'a pas cotisé n'a rien
--   épargné pour cette période et doit la pénalité de retard (250 FCFA par défaut, une fois
--   par période), retenue à la répartition s'il ne la règle pas avant ;
-- - à la date prévue, l'admin lance la répartition : chacun reçoit ce qu'il a réellement
--   versé (moins ses pénalités impayées). C'est un dernier « tour » (purpose = 'distribution')
--   dont chaque membre est bénéficiaire : l'envoi Wave / Orange Money, la seconde validation
--   du super admin (300 000 FCFA ou plus) et la confirmation de réception sont ceux des
--   cagnottes de tontine ;
-- - retrait d'urgence : le membre le demande, l'admin l'accorde ; il reçoit son épargne
--   (tour purpose = 'withdrawal') et quitte le Denthie ;
-- - personne ne rejoint en cours de route (déjà la règle : group_request_join refuse un
--   groupe démarré) ;
-- - revenu de la plateforme : les frais d'adhésion seulement (pas de période de service) ;
--   ils donnent accès au carnet électronique du membre (écran de l'application).
--
-- Les fonctions group_create, group_start et round_payout deviennent des aiguillages : la
-- tontine garde son code (renommé …_tontine), le Denthie a le sien. Une migration future qui
-- redéfinit l'une de ces trois fonctions doit garder l'aiguillage.

-- ---------------------------------------------------------------------------
-- 1. Schéma
-- ---------------------------------------------------------------------------

alter type public.audit_action add value if not exists 'denthie_distribution';
alter type public.audit_action add value if not exists 'denthie_withdrawal';
alter type public.audit_action add value if not exists 'withdrawal_requested';

alter table public.groups
  add column kind text not null default 'tontine' check (kind in ('tontine', 'denthie')),
  add column end_date date;

comment on column public.groups.kind is
  'tontine : un bénéficiaire par tour ; denthie : épargne gardée puis répartie à la fin.';
comment on column public.groups.end_date is
  'Denthie : date de répartition, fixée par l’admin après la création (null : pas encore fixée).';

alter table public.rounds
  add column purpose text not null default 'turn'
    check (purpose in ('turn', 'distribution', 'withdrawal'));

comment on column public.rounds.purpose is
  'turn : tour de tontine ou période d’un Denthie ; distribution : répartition finale d’un Denthie ; withdrawal : retrait d’urgence.';

-- Règles fixes d'un Denthie (pas de tours à bénéficiaires, pas de période de service) ; le
-- type ne change plus après le démarrage ; un nouveau cycle efface la date de répartition.
create or replace function private.groups_denthie_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.kind is distinct from old.kind and old.status <> 'draft' then
    raise exception 'Le type du groupe ne change plus après le démarrage.' using errcode = '22023';
  end if;
  if new.kind = 'denthie' then
    new.turn_length := 1;
    new.shares_per_round := 1;
    new.reserve_final_turn := false;
    new.attribution_mode := 'manual';
  end if;
  if tg_op = 'UPDATE' and new.status = 'draft' and old.status <> 'draft' then
    new.end_date := null;
  end if;
  return new;
end;
$$;

create trigger groups_denthie_rules
before insert or update on public.groups
for each row execute function private.groups_denthie_rules();

-- ---------------------------------------------------------------------------
-- 2. Création et démarrage
-- ---------------------------------------------------------------------------

alter function public.group_create(jsonb) rename to group_create_tontine;
revoke all on function public.group_create_tontine(jsonb) from public, anon, authenticated;

create function public.group_create(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  chosen_kind text := coalesce(nullif(p ->> 'kind', ''), 'tontine');
  new_id uuid;
begin
  if chosen_kind not in ('tontine', 'denthie') then
    raise exception 'Type de groupe inconnu.' using errcode = '22023';
  end if;
  if chosen_kind = 'denthie' then
    p := p || jsonb_build_object(
      'turnLength', 1, 'sharesPerRound', 1, 'reserveFinalTurn', false,
      'attributionMode', 'manual',
      'latePenalty', coalesce(nullif(p ->> 'latePenalty', '')::integer, 250));
  end if;
  new_id := public.group_create_tontine(p);
  if chosen_kind = 'denthie' then
    update public.groups set kind = 'denthie' where id = new_id;
  end if;
  return new_id;
end;
$$;

revoke all on function public.group_create(jsonb) from public, anon;
grant execute on function public.group_create(jsonb) to authenticated;

-- Épargne d'une personne dans le cycle en cours d'un Denthie : ses cotisations payées sur
-- les périodes (frais d'adhésion, pénalités et frais de paiement exclus).
create or replace function private.denthie_saved(p_group uuid, p_user uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(p.contribution_amount), 0)::integer
  from public.payments p
  join public.rounds r on r.id = p.round_id
  join public.groups g on g.id = r.group_id
  where r.group_id = p_group and r.cycle = g.current_cycle and r.purpose = 'turn'
    and p.user_id = p_user and p.status = 'paid'
$$;

-- Ouvre la période suivante d'un Denthie en cours, s'il n'y en a pas d'ouverte et que la
-- date de répartition n'est pas atteinte. Renvoie true si une période a été ouverte.
create or replace function private.denthie_open_period(p_group uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.groups;
  periods integer;
  open_d date;
  next_number integer;
begin
  select * into g from public.groups where id = p_group for update;
  if not found or g.kind <> 'denthie' or g.status <> 'active' then
    return false;
  end if;
  if exists (
    select 1 from public.rounds
    where group_id = g.id and cycle = g.current_cycle
      and ((purpose = 'turn' and status <> 'paid_out') or purpose = 'distribution')
  ) then
    return false;
  end if;
  select count(*) into periods from public.rounds
  where group_id = g.id and cycle = g.current_cycle and purpose = 'turn';
  open_d := private.add_periods(g.start_date, g.frequency, periods);
  if g.end_date is not null and open_d >= g.end_date then
    return false;
  end if;
  select coalesce(max(number), 0) + 1 into next_number from public.rounds
  where group_id = g.id and cycle = g.current_cycle;
  insert into public.rounds (group_id, cycle, number, open_date, due_date, recipient_type,
    pot_amount, status, purpose)
  values (g.id, g.current_cycle, next_number, open_d,
    private.round_due_date(open_d, g.frequency, g.payment_due_day, 1),
    'members', g.contribution_amount * private.active_share_count(g.id), 'open', 'turn');
  return true;
end;
$$;

alter function public.group_start(uuid) rename to group_start_tontine;
revoke all on function public.group_start_tontine(uuid) from public, anon, authenticated;

create function public.group_start(p_group uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.groups := private.require_group(p_group);
  uid uuid;
  first_due date;
begin
  if g.kind <> 'denthie' then
    perform public.group_start_tontine(p_group);
    return;
  end if;
  uid := private.require_manage(g);
  if g.status <> 'draft' then
    raise exception 'Le Denthie a déjà démarré.' using errcode = '22023';
  end if;
  if (select count(distinct user_id) from public.memberships
      where group_id = g.id and status = 'active') < 2 then
    raise exception 'Un Denthie doit avoir au moins deux personnes distinctes.' using errcode = '22023';
  end if;
  if g.start_date < current_date then
    raise exception 'La date de démarrage est passée : choisissez-en une nouvelle dans les réglages.'
      using errcode = '22023';
  end if;
  if g.end_date is not null and g.end_date <= g.start_date then
    raise exception 'La date de répartition doit venir après le démarrage.' using errcode = '22023';
  end if;
  -- Pas d'ordre de passage : les parts sont seulement numérotées (ordre d'arrivée), et la
  -- liste est close (personne ne rejoint en cours de route).
  update public.memberships set payout_order = null where group_id = g.id;
  update public.memberships m set payout_order = ranked.n
  from (
    select id, row_number() over (order by joined_at, id) as n
    from public.memberships where group_id = g.id and status = 'active'
  ) ranked
  where m.id = ranked.id;
  update public.groups set status = 'active', max_members = private.active_share_count(g.id)
  where id = g.id;
  perform private.denthie_open_period(g.id);
  select due_date into first_due from public.rounds
  where group_id = g.id and cycle = g.current_cycle and purpose = 'turn'
  order by number limit 1;
  insert into public.notifications (user_id, type, title, body, link)
  select distinct m.user_id, 'started', 'Le Denthie démarre',
    format('%s a démarré : première cotisation de %s avant le %s. L’argent est gardé jusqu’à la répartition.',
      g.name, private.format_amount(g.contribution_amount), to_char(first_due, 'DD/MM/YYYY')),
    '/groupes/' || g.id
  from public.memberships m
  where m.group_id = g.id and m.status = 'active';
  perform private.audit(uid, 'group_updated', format('a démarré le Denthie « %s »', g.name), g.id);
end;
$$;

revoke all on function public.group_start(uuid) from public, anon;
grant execute on function public.group_start(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Périodes : clôture à l'heure limite, période suivante
-- ---------------------------------------------------------------------------

-- Tous ont cotisé : la période est complète (message propre au Denthie, rien à verser).
create or replace function private.refresh_round(p_round uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.rounds;
  g public.groups;
begin
  select * into r from public.rounds where id = p_round;
  if r.status <> 'open'
    or private.round_paid_shares(r.id) < private.active_share_count(r.group_id)
    or private.active_share_count(r.group_id) = 0 then
    return;
  end if;
  select * into g from public.groups where id = r.group_id;
  update public.rounds set status = 'ready_for_payout' where id = r.id;
  if g.kind = 'denthie' then
    perform private.notify_managers(g.id, 'period_complete', 'Période complète',
      format('%s : tous les membres ont cotisé pour la période du %s.', g.name,
        to_char(r.open_date, 'DD/MM/YYYY')));
    return;
  end if;
  if r.recipient_type = 'platform' then
    insert into public.notifications (user_id, type, title, body, link)
    select p.id, 'platform_income_ready', 'Revenu plateforme prêt',
      format('%s : toutes les cotisations de la période réservée sont reçues.', g.name),
      '/admin/versements'
    from public.profiles p
    where p.global_role = 'super_admin' and not p.is_suspended and p.deleted_at is null;
  end if;
  perform private.notify_managers(g.id, 'ready_for_payout', 'Tour prêt pour le reversement',
    format('%s : tous les membres ont payé le tour %s.', g.name, r.number));
end;
$$;

-- Clôt une période : ce qui n'a pas été cotisé n'est pas épargné (rien n'est dû aux autres),
-- la pénalité impayée devient une dette, retenue à la répartition si elle n'est pas réglée.
create or replace function private.denthie_close_period(r public.rounds, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.groups;
  late record;
begin
  select * into g from public.groups where id = r.group_id;
  for late in
    select u.user_id,
      g.contribution_amount * u.shares
        - coalesce((select sum(p.contribution_amount) from public.payments p
                    where p.round_id = r.id and p.user_id = u.user_id and p.status = 'paid'), 0)
        as contribution_left,
      greatest(0, coalesce((select sum(pe.amount) from public.penalties pe
                            where pe.round_id = r.id and pe.user_id = u.user_id), 0)
        - coalesce((select sum(p.late_penalty_amount) from public.payments p
                    where p.round_id = r.id and p.user_id = u.user_id and p.status = 'paid'), 0))
        as penalty_left
    from (select user_id, count(*) as shares from public.memberships
          where group_id = g.id and status = 'active' group by user_id) u
  loop
    if late.penalty_left > 0 then
      insert into public.debts (group_id, round_id, user_id, amount, penalty_amount)
      values (g.id, r.id, late.user_id, 0, late.penalty_left)
      on conflict (round_id, user_id) do nothing;
    end if;
    if late.contribution_left > 0 then
      perform private.notify(late.user_id, 'debt', 'Période close',
        format('%s : la période du %s est close sans toute votre cotisation (%s non épargnés).%s',
          g.name, to_char(r.open_date, 'DD/MM/YYYY'),
          private.format_amount(late.contribution_left::integer),
          case when late.penalty_left > 0 then format(
            ' Pénalité de %s à régler, sinon elle sera retenue à la répartition.',
            private.format_amount(late.penalty_left::integer)) else '' end),
        '/groupes/' || g.id);
    end if;
  end loop;
  update public.rounds
  set status = 'paid_out', paid_out_at = now(), payout_validated_by = p_actor
  where id = r.id;
end;
$$;

-- Tâche planifiée : pénalités, clôture des périodes échues, ouverture des suivantes.
create or replace function private.denthie_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.rounds;
  g public.groups;
  closed uuid[] := '{}';
  next_round public.rounds;
begin
  perform private.apply_late_penalties();
  for r in
    select rr.* from public.rounds rr
    join public.groups gg on gg.id = rr.group_id
    where gg.kind = 'denthie' and gg.status = 'active' and rr.purpose = 'turn'
      and rr.status in ('open', 'ready_for_payout')
      and private.round_deadline(rr.id) <= now()
  loop
    perform private.denthie_close_period(r, null);
    closed := closed || r.group_id;
  end loop;

  for g in select * from public.groups where kind = 'denthie' and status = 'active' loop
    if private.denthie_open_period(g.id) then
      select * into next_round from public.rounds
      where group_id = g.id and cycle = g.current_cycle and purpose = 'turn'
      order by number desc limit 1;
      insert into public.notifications (user_id, type, title, body, link)
      select distinct m.user_id, 'new_period', 'Nouvelle période',
        format('%s : cotisation de %s à verser avant le %s.', g.name,
          private.format_amount(g.contribution_amount * (
            select count(*) from public.memberships m2
            where m2.group_id = g.id and m2.user_id = m.user_id and m2.status = 'active')::integer),
          to_char(next_round.due_date, 'DD/MM/YYYY')),
        '/groupes/' || g.id
      from public.memberships m
      where m.group_id = g.id and m.status = 'active';
    elsif g.id = any (closed) and g.end_date is not null and not exists (
      select 1 from public.rounds
      where group_id = g.id and cycle = g.current_cycle and purpose = 'turn' and status <> 'paid_out'
    ) then
      perform private.notify_managers(g.id, 'denthie_end', 'Denthie terminé',
        format('%s : toutes les périodes sont closes. Lancez la répartition à partir du %s.',
          g.name, to_char(g.end_date, 'DD/MM/YYYY')));
    end if;
  end loop;
end;
$$;

-- Décalé des pénalités (*/15) pour ne pas tourner à la même minute.
select cron.schedule('calebasse-denthie', '7,22,37,52 * * * *', 'select private.denthie_tick()');

-- ---------------------------------------------------------------------------
-- 4. Date de répartition
-- ---------------------------------------------------------------------------

create or replace function public.denthie_set_end_date(p_group uuid, p_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.groups := private.require_group(p_group);
  uid uuid := private.require_manage(g);
  current_open date;
begin
  if g.kind <> 'denthie' then
    raise exception 'Réservé aux Denthie.' using errcode = '22023';
  end if;
  perform private.assert_group_open(g);
  if exists (select 1 from public.rounds
             where group_id = g.id and cycle = g.current_cycle and purpose = 'distribution') then
    raise exception 'La répartition est déjà lancée.' using errcode = '22023';
  end if;
  if p_date is not null then
    if p_date <= current_date then
      raise exception 'Choisissez une date à venir.' using errcode = '22023';
    end if;
    if p_date <= g.start_date then
      raise exception 'La répartition doit venir après le démarrage (%).',
        to_char(g.start_date, 'DD/MM/YYYY') using errcode = '22023';
    end if;
    select max(open_date) into current_open from public.rounds
    where group_id = g.id and cycle = g.current_cycle and purpose = 'turn';
    if current_open is not null and p_date <= current_open then
      raise exception 'Choisissez une date après le début de la période en cours (%).',
        to_char(current_open, 'DD/MM/YYYY') using errcode = '22023';
    end if;
  end if;
  if p_date is not distinct from g.end_date then
    return;
  end if;
  update public.groups set end_date = p_date where id = g.id;
  insert into public.notifications (user_id, type, title, body, link)
  select distinct m.user_id, 'denthie_end_date', 'Date de répartition',
    case when p_date is null
      then format('%s : la date de répartition est retirée, les cotisations continuent.', g.name)
      else format('%s : la répartition est prévue le %s. Les cotisations s’arrêtent à cette date.',
        g.name, to_char(p_date, 'DD/MM/YYYY')) end,
    '/groupes/' || g.id
  from public.memberships m
  where m.group_id = g.id and m.status = 'active' and m.user_id <> uid;
  perform private.audit(uid, 'group_updated',
    case when p_date is null then format('a retiré la date de répartition — %s', g.name)
      else format('a fixé la répartition au %s — %s', to_char(p_date, 'DD/MM/YYYY'), g.name) end,
    g.id);
  -- Date retirée ou reculée alors que tout était clos : la période suivante s'ouvre.
  perform private.denthie_open_period(g.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Versement d'argent : répartition finale et retrait d'urgence
-- ---------------------------------------------------------------------------

-- Parts d'un tour de versement Denthie : l'épargne de chaque personne, partagée entre ses
-- parts (le reste de la division va à la première), puis ses dettes ouvertes retenues.
create or replace function private.denthie_fill_beneficiaries(r public.rounds, p_users uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.round_beneficiaries where round_id = r.id;
  insert into public.round_beneficiaries (round_id, membership_id, amount)
  select r.id, m.id,
    s.saved / s.shares + case when m.rn <= s.saved % s.shares then 1 else 0 end
  from (
    select id, user_id, row_number() over (partition by user_id order by payout_order, id) as rn
    from public.memberships
    where group_id = r.group_id and status = 'active' and user_id = any (p_users)
  ) m
  join (
    select user_id, count(*)::integer as shares, private.denthie_saved(r.group_id, user_id) as saved
    from public.memberships
    where group_id = r.group_id and status = 'active' and user_id = any (p_users)
    group by user_id
  ) s on s.user_id = m.user_id
  where s.saved > 0;
end;
$$;

create or replace function private.denthie_withhold_debts(r public.rounds, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  debtor record;
begin
  for debtor in
    select m.user_id, min(b.membership_id::text)::uuid as part,
      private.open_debt(r.group_id, m.user_id) as owed
    from public.round_beneficiaries b join public.memberships m on m.id = b.membership_id
    where b.round_id = r.id
    group by m.user_id
  loop
    if debtor.owed > 0 then
      update public.round_beneficiaries
      set withheld = least(amount, debtor.owed), amount = amount - least(amount, debtor.owed)
      where round_id = r.id and membership_id = debtor.part;
      insert into public.platform_earnings (group_id, kind, amount, round_id, user_id)
      select r.group_id, 'late_penalty', sum(d.penalty_amount), r.id, debtor.user_id
      from public.debts d
      where d.group_id = r.group_id and d.user_id = debtor.user_id and d.status = 'open'
      having sum(d.penalty_amount) > 0;
      update public.debts
      set status = 'settled', settled_via = 'withheld', settled_round_id = r.id,
        settled_by = p_actor, settled_at = now()
      where group_id = r.group_id and user_id = debtor.user_id and status = 'open';
    end if;
  end loop;
end;
$$;

-- Premier membre (dans la liste donnée) sans numéro de reversement alors qu'il a épargné.
create or replace function private.denthie_missing_payout(p_group uuid, p_users uuid[])
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select private.full_name(p.id)
  from public.profiles p
  where p.id = any (p_users) and p.payout_phone is null
    and private.denthie_saved(p_group, p.id) > 0
  limit 1
$$;

-- Répartition : l'admin la lance à partir de la date prévue. Grosse somme : l'admin la
-- demande, le super admin la valide (même seuil que les cagnottes). Renvoie 'paid' ou
-- 'pending_approval'.
create or replace function public.denthie_distribute(p_group uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.groups := private.require_group(p_group);
  uid uuid := private.require_manage(g);
  d public.rounds;
  r public.rounds;
  members uuid[];
  missing text;
  total integer;
begin
  if g.kind <> 'denthie' then
    raise exception 'Réservé aux Denthie.' using errcode = '22023';
  end if;
  perform private.assert_group_open(g);
  if g.status <> 'active' then
    raise exception 'Ce Denthie n’a pas démarré.' using errcode = '22023';
  end if;
  if g.end_date is null then
    raise exception 'Fixez d’abord la date de répartition.' using errcode = '22023';
  end if;
  if g.end_date > current_date then
    raise exception 'La répartition se lance à partir du %.', to_char(g.end_date, 'DD/MM/YYYY')
      using errcode = '22023';
  end if;
  select * into d from public.rounds
  where group_id = g.id and cycle = g.current_cycle and purpose = 'distribution';
  if found and d.payout_blocked_at is not null then
    raise exception 'Répartition bloquée par l’administration de la plateforme : %.',
      coalesce(d.payout_block_reason, 'vérification en cours') using errcode = '22023';
  end if;

  -- Les périodes encore ouvertes sont closes (pénalité si leur heure limite est passée).
  perform private.apply_late_penalties();
  for r in select * from public.rounds
           where group_id = g.id and cycle = g.current_cycle and purpose = 'turn'
             and status <> 'paid_out' loop
    perform private.denthie_close_period(r, uid);
  end loop;

  select array_agg(distinct user_id) into members from public.memberships
  where group_id = g.id and status = 'active';
  missing := private.denthie_missing_payout(g.id, members);
  if missing is not null then
    raise exception '% n’a pas renseigné de numéro de reversement (Profil).', missing
      using errcode = '22023';
  end if;
  select coalesce(sum(private.denthie_saved(g.id, u)), 0) into total from unnest(members) u;

  if d.id is null then
    insert into public.rounds (group_id, cycle, number, open_date, due_date, recipient_type,
      pot_amount, status, purpose)
    values (g.id, g.current_cycle,
      (select coalesce(max(number), 0) + 1 from public.rounds
       where group_id = g.id and cycle = g.current_cycle),
      current_date, current_date, 'members', total, 'upcoming', 'distribution')
    returning * into d;
  else
    update public.rounds set pot_amount = total where id = d.id returning * into d;
  end if;
  perform private.denthie_fill_beneficiaries(d, members);

  if total >= private.payout_approval_threshold() and not private.is_super_admin() then
    if d.payout_requested_at is null then
      update public.rounds set payout_requested_at = now(), payout_requested_by = uid
      where id = d.id;
      insert into public.notifications (user_id, type, title, body, link)
      select p.id, 'payout_approval', 'Répartition à valider',
        format('%s : répartition de %s entre les membres du Denthie, à valider.', g.name,
          private.format_amount(total)),
        '/admin/versements'
      from public.profiles p
      where p.global_role = 'super_admin' and not p.is_suspended and p.deleted_at is null;
      perform private.audit(uid, 'denthie_distribution',
        format('a demandé la validation de la répartition (%s) — %s',
          private.format_amount(total), g.name), g.id);
    end if;
    return 'pending_approval';
  end if;

  update public.rounds
  set status = 'paid_out', paid_out_at = now(), payout_validated_by = uid
  where id = d.id;
  perform private.denthie_withhold_debts(d, uid);
  update public.groups set status = 'finished' where id = g.id;

  insert into public.notifications (user_id, type, title, body, link)
  select m.user_id, 'payout', 'Répartition validée',
    format('%s : votre épargne de %s est validée, elle va vous être envoyée%s.', g.name,
      private.format_amount(sum(b.amount)::integer),
      case when sum(b.withheld) > 0
        then format(' (%s retenus pour vos pénalités)', private.format_amount(sum(b.withheld)::integer))
        else '' end),
    '/groupes/' || g.id
  from public.round_beneficiaries b join public.memberships m on m.id = b.membership_id
  where b.round_id = d.id
  group by m.user_id;
  perform private.notify_managers(g.id, 'denthie_distribution', 'Répartition validée',
    format('%s : envoyez maintenant à chaque membre sa part (Tours → Cagnottes à envoyer).', g.name));
  perform private.audit(uid, 'denthie_distribution',
    format('a validé la répartition de %s — %s', private.format_amount(total), g.name), g.id);
  return 'paid';
end;
$$;

-- Le membre demande un retrait d'urgence ; les gestionnaires décident.
create or replace function public.denthie_withdraw_request(p_group uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  g public.groups := private.require_group(p_group);
  reason text := btrim(coalesce(p_reason, ''));
begin
  if g.kind <> 'denthie' or g.status <> 'active' then
    raise exception 'Le retrait d’urgence concerne un Denthie en cours.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.memberships
                 where group_id = g.id and user_id = uid and status = 'active') then
    raise exception 'Vous ne faites pas partie de ce Denthie.' using errcode = '42501';
  end if;
  if char_length(reason) not between 4 and 300 then
    raise exception 'Expliquez en quelques mots la raison de l’urgence.' using errcode = '22023';
  end if;
  perform private.inspect_input('Raison', reason);
  if exists (select 1 from public.audit_log
             where actor_id = uid and group_id = g.id and action = 'withdrawal_requested'
               and at > now() - interval '1 day') then
    raise exception 'Votre demande a déjà été envoyée : l’administrateur va vous répondre.'
      using errcode = '22023';
  end if;
  perform private.notify_managers(g.id, 'withdrawal_request', 'Demande de retrait d’urgence',
    format('%s demande à retirer son épargne de %s (%s) : « %s ».', private.full_name(uid),
      g.name, private.format_amount(private.denthie_saved(g.id, uid)), reason));
  perform private.audit(uid, 'withdrawal_requested',
    format('a demandé un retrait d’urgence — %s', g.name), g.id);
end;
$$;

-- Retrait d'urgence accordé : la personne reçoit son épargne (moins ses dettes) et quitte le
-- Denthie. Au-delà du seuil de seconde validation, c'est le super admin qui l'accorde.
create or replace function public.denthie_withdraw(p_group uuid, p_user uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.groups := private.require_group(p_group);
  uid uuid := private.require_manage(g);
  reason text := btrim(coalesce(p_reason, ''));
  saved integer;
  w public.rounds;
  r public.rounds;
  sent integer;
  kept integer;
begin
  if g.kind <> 'denthie' then
    raise exception 'Réservé aux Denthie.' using errcode = '22023';
  end if;
  perform private.assert_group_open(g);
  if g.status <> 'active' then
    raise exception 'Le retrait d’urgence concerne un Denthie en cours.' using errcode = '22023';
  end if;
  if exists (select 1 from public.rounds
             where group_id = g.id and cycle = g.current_cycle and purpose = 'distribution') then
    raise exception 'La répartition est lancée : chacun recevra sa part.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.memberships
                 where group_id = g.id and user_id = p_user and status = 'active') then
    raise exception 'Cette personne ne fait pas partie du Denthie.' using errcode = '22023';
  end if;
  if char_length(reason) not between 4 and 300 then
    raise exception 'Indiquez la raison du retrait d’urgence.' using errcode = '22023';
  end if;
  perform private.inspect_input('Raison', reason);
  saved := private.denthie_saved(g.id, p_user);
  if saved >= private.payout_approval_threshold() and not private.is_super_admin() then
    raise exception 'Retrait de % ou plus : il doit être accordé par le super administrateur.',
      private.format_amount(private.payout_approval_threshold()) using errcode = '42501';
  end if;
  if private.denthie_missing_payout(g.id, array[p_user]) is not null then
    raise exception '% n’a pas renseigné de numéro de reversement (Profil).',
      private.full_name(p_user) using errcode = '22023';
  end if;

  if saved > 0 then
    insert into public.rounds (group_id, cycle, number, open_date, due_date, recipient_type,
      pot_amount, status, paid_out_at, payout_validated_by, purpose)
    values (g.id, g.current_cycle,
      (select coalesce(max(number), 0) + 1 from public.rounds
       where group_id = g.id and cycle = g.current_cycle),
      current_date, current_date, 'members', saved, 'paid_out', now(), uid, 'withdrawal')
    returning * into w;
    perform private.denthie_fill_beneficiaries(w, array[p_user]);
    perform private.denthie_withhold_debts(w, uid);
    select coalesce(sum(amount), 0), coalesce(sum(withheld), 0) into sent, kept
    from public.round_beneficiaries where round_id = w.id;
  end if;

  update public.memberships set status = 'removed', payout_order = null
  where group_id = g.id and user_id = p_user and status = 'active';
  -- Périodes en cours : cagnotte recalculée sans ses parts (elle peut devenir complète).
  update public.rounds
  set pot_amount = g.contribution_amount * private.active_share_count(g.id)
  where group_id = g.id and purpose = 'turn' and status in ('open', 'ready_for_payout');
  for r in select * from public.rounds
           where group_id = g.id and purpose = 'turn' and status = 'open' loop
    perform private.refresh_round(r.id);
  end loop;

  perform private.notify(p_user, 'payout', 'Retrait d’urgence accordé',
    case when saved > 0
      then format('%s : votre épargne de %s va vous être envoyée%s. Vous ne cotisez plus dans ce Denthie.',
        g.name, private.format_amount(sent),
        case when kept > 0 then format(' (%s retenus pour vos pénalités)', private.format_amount(kept))
          else '' end)
      else format('%s : vous quittez le Denthie (aucune épargne à vous rendre).', g.name) end,
    '/groupes');
  if saved > 0 then
    perform private.notify_managers(g.id, 'denthie_withdrawal', 'Retrait d’urgence à envoyer',
      format('%s : envoyez %s à %s (Tours → Cagnottes à envoyer).', g.name,
        private.format_amount(sent), private.full_name(p_user)));
  end if;
  perform private.audit(uid, 'denthie_withdrawal',
    format('a accordé un retrait d’urgence de %s à %s (« %s ») — %s',
      private.format_amount(coalesce(sent, 0)), private.full_name(p_user), reason, g.name), g.id);
end;
$$;

-- Le versement d'une cagnotte ne s'applique pas aux périodes d'un Denthie ; la validation de
-- sa répartition par le super admin passe par denthie_distribute.
alter function public.round_payout(uuid) rename to round_payout_tontine;
revoke all on function public.round_payout_tontine(uuid) from public, anon, authenticated;

create function public.round_payout(p_round uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.rounds := private.require_round(p_round);
  g public.groups;
begin
  select * into g from public.groups where id = r.group_id;
  if g.kind = 'denthie' then
    if r.purpose = 'distribution' then
      return public.denthie_distribute(g.id);
    end if;
    raise exception 'Dans un Denthie, l’argent reste dans la caisse jusqu’à la répartition.'
      using errcode = '22023';
  end if;
  return public.round_payout_tontine(p_round);
end;
$$;

do $grants$
declare
  fn text;
begin
  foreach fn in array array[
    'round_payout(uuid)',
    'denthie_set_end_date(uuid, date)',
    'denthie_distribute(uuid)',
    'denthie_withdraw_request(uuid, text)',
    'denthie_withdraw(uuid, uuid, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end;
$grants$;
