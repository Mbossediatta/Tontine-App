-- Retards, pénalités et dettes.
-- 1. Heure limite de paiement, choisie par l'admin (heure de Dakar) : en retard après la date
--    limite du tour à cette heure, plus le délai de grâce (Paramètres → Règles).
-- 2. Pénalité de retard posée d'office, une fois par tour : tâche planifiée (pg_cron) toutes
--    les 15 minutes ; le membre et les admins sont prévenus.
-- 3. Impayés : passé la limite, l'admin peut verser la cagnotte quand même (le montant
--    réellement collecté). Ce qui manque devient une dette du membre, qu'il rembourse plus
--    tard ; sinon elle est retenue sur sa propre cagnotte à son tour.

-- ---------------------------------------------------------------------------
-- 1. Heure limite
-- ---------------------------------------------------------------------------

alter table public.groups add column payment_due_time time not null default '23:59';

-- Moment exact où un membre qui n'a pas tout payé passe en retard.
create or replace function private.round_deadline(p_round uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select ((r.due_date + coalesce((s.rules ->> 'graceDays')::integer, 0))::timestamp
          + g.payment_due_time) at time zone 'Africa/Dakar'
  from public.rounds r
  join public.groups g on g.id = r.group_id
  cross join public.platform_settings s
  where r.id = p_round
$$;

create or replace function private.is_late(p_round uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.round_paid(p_round, p_user) < private.round_total(p_round, p_user)
    and (
      exists (select 1 from public.penalties pe where pe.round_id = p_round and pe.user_id = p_user)
      or private.round_deadline(p_round) <= now()
    )
$$;

-- Heure limite d'un groupe (« HH:MM », heure de Dakar), par un de ses administrateurs.
create or replace function public.group_set_due_time(p_group uuid, p_time text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.groups := private.require_group(p_group);
  uid uuid := private.require_manage(g);
  due time;
begin
  if p_time is null or p_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Heure limite invalide (format HH:MM).' using errcode = '22023';
  end if;
  due := p_time::time;
  if due is distinct from g.payment_due_time then
    update public.groups set payment_due_time = due where id = g.id;
    perform private.audit(uid, 'group_updated',
      format('a fixé l’heure limite de paiement à %s — %s', to_char(due, 'HH24"h"MI'), g.name), g.id);
  end if;
end;
$$;

revoke all on function public.group_set_due_time(uuid, text) from public, anon;
grant execute on function public.group_set_due_time(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Pénalités d'office
-- ---------------------------------------------------------------------------

-- Pose la pénalité du groupe (une fois par tour) à chaque membre qui n'a pas tout payé
-- après l'heure limite. Renvoie le nombre de pénalités posées.
create or replace function private.apply_late_penalties()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  added integer;
begin
  with late as (
    select r.id as round_id, r.number, g.id as group_id, g.name, u.user_id,
      coalesce(g.late_penalty, 0) as amount
    from public.rounds r
    join public.groups g on g.id = r.group_id
    join (select distinct group_id, user_id from public.memberships where status = 'active') u
      on u.group_id = g.id
    where r.status in ('open', 'ready_for_payout')
      and g.status = 'active'
      and private.round_deadline(r.id) <= now()
      and not exists (select 1 from public.penalties pe
                      where pe.round_id = r.id and pe.user_id = u.user_id)
      and private.round_paid(r.id, u.user_id) < private.round_total(r.id, u.user_id)
  ),
  added_rows as (
    insert into public.penalties (round_id, user_id, amount)
    select round_id, user_id, amount from late where amount > 0
    on conflict (round_id, user_id) do nothing
    returning round_id, user_id
  ),
  notified as (
    insert into public.notifications (user_id, type, title, body, link)
    select l.user_id, 'late', 'Date limite dépassée',
      format('%s : une pénalité de %s a été ajoutée. Total à payer : %s.', l.name,
        private.format_amount(l.amount),
        private.format_amount((private.amount_due(l.round_id, l.user_id) + l.amount)::integer)),
      '/groupes/' || l.group_id
    from late l join added_rows a on a.round_id = l.round_id and a.user_id = l.user_id
    returning 1
  )
  select count(*) into added from notified;

  -- Les admins sont prévenus une fois par tour, au premier passage en retard.
  insert into public.notifications (user_id, type, title, body, link)
  select distinct manager.user_id, 'late', 'Membres en retard',
    format('%s : %s membre(s) en retard sur le tour %s.', g.name, cnt.n, r.number),
    '/admin/groupes/' || g.id
  from (select pe.round_id, count(*) as n from public.penalties pe
        where pe.applied_at > now() - interval '1 minute' group by pe.round_id) cnt
  join public.rounds r on r.id = cnt.round_id
  join public.groups g on g.id = r.group_id
  join lateral (
    select g.admin_id as user_id
    union
    select m.user_id from public.memberships m
    where m.group_id = g.id and m.status = 'active' and m.role in ('owner', 'co_admin')
  ) manager on manager.user_id is not null;
  return added;
end;
$$;

create extension if not exists pg_cron;
select cron.schedule('calebasse-penalites', '*/15 * * * *', 'select private.apply_late_penalties()');

-- ---------------------------------------------------------------------------
-- 3. Dettes
-- ---------------------------------------------------------------------------

create type public.debt_status as enum ('open', 'settled');
create type public.debt_settlement as enum ('cash', 'withheld');

-- Ce qu'un membre n'avait pas payé quand la cagnotte du tour a été versée sans lui.
create table public.debts (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  round_id uuid not null references public.rounds (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Cotisation manquante : due aux bénéficiaires du tour.
  amount integer not null check (amount >= 0),
  -- Pénalité impayée : revenu de la plateforme.
  penalty_amount integer not null default 0 check (penalty_amount >= 0),
  status public.debt_status not null default 'open',
  settled_via public.debt_settlement,
  -- Tour sur lequel la dette a été retenue (cagnotte du débiteur).
  settled_round_id uuid references public.rounds (id) on delete set null,
  settled_by uuid references public.profiles (id) on delete set null,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint debts_one_per_round unique (round_id, user_id),
  constraint debts_positive check (amount + penalty_amount > 0),
  constraint debts_settled check ((status = 'settled') = (settled_at is not null))
);

create index debts_group_idx on public.debts (group_id, status);
create index debts_user_idx on public.debts (user_id, status);

alter table public.debts enable row level security;
grant select on public.debts to authenticated;
create policy debts_select on public.debts
  for select to authenticated
  using (user_id = (select private.active_uid()) or private.can_manage_group(group_id));

-- Retenue sur une part bénéficiaire : ce qui a été pris pour rembourser des dettes.
alter table public.round_beneficiaries
  add column withheld integer not null default 0 check (withheld >= 0);

-- Ce que doit encore une personne dans un groupe.
create or replace function private.open_debt(p_group uuid, p_user uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(amount + penalty_amount), 0)::integer from public.debts
  where group_id = p_group and user_id = p_user and status = 'open'
$$;

-- Versement de la cagnotte : tout le monde a payé, ou l'heure limite (+ grâce) est passée.
-- Les bénéficiaires se partagent ce qui a réellement été collecté ; chaque impayé devient
-- une dette ; une dette du bénéficiaire est retenue sur sa part.
create or replace function public.round_payout(p_round uuid)
returns void
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
        format('%s : la cagnotte du tour %s a été versée sans votre cotisation. Vous devez %s ; sans remboursement, ce montant sera retenu sur votre cagnotte.',
          g.name, r.number,
          private.format_amount((debtor.contribution_left + debtor.penalty_left)::integer)),
        '/groupes/' || g.id);
    end if;
  end loop;

  update public.rounds
  set status = 'paid_out', paid_out_at = now(), payout_validated_by = uid
  where id = r.id;

  collected := coalesce((select sum(p.contribution_amount) from public.payments p
                         where p.round_id = r.id and p.status = 'paid'), 0);

  if r.recipient_type = 'platform' then
    insert into public.platform_earnings (group_id, kind, amount, round_id)
    select g.id, 'reserved_turn', collected, r.id where collected > 0;
  else
    -- Partage de ce qui a été collecté, à l'unité près (les premières parts reçoivent le reste).
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

    -- Dettes d'un bénéficiaire : retenues sur sa part (première part dans l'ordre).
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
        -- Pénalités retenues : revenu de la plateforme.
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

    insert into public.notifications (user_id, type, title, body, link)
    select m.user_id, 'payout', 'Cagnotte reçue',
      format('Vous avez reçu %s de %s%s.', private.format_amount(sum(b.amount)::integer), g.name,
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
    return;
  end if;
  update public.rounds set status = 'open' where id = next_round.id;
  insert into public.notifications (user_id, type, title, body, link)
  select distinct m.user_id, 'beneficiary', 'Nouveau tour ouvert',
    format('%s : votre part est bénéficiaire au tour %s.', g.name, next_round.number),
    '/groupes/' || g.id
  from public.round_beneficiaries b join public.memberships m on m.id = b.membership_id
  where b.round_id = next_round.id;
end;
$$;

-- Remboursement d'une dette reçu en espèces par un admin du groupe.
create or replace function public.debt_record_payment(p_debt uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.debts;
  g public.groups;
  uid uuid;
  r public.rounds;
begin
  select * into d from public.debts where id = p_debt for update;
  if not found then
    raise exception 'Cette dette n’existe pas.' using errcode = 'P0002';
  end if;
  g := private.require_group(d.group_id);
  uid := private.require_manage(g);
  if d.status <> 'open' then
    raise exception 'Cette dette est déjà réglée.' using errcode = '22023';
  end if;
  select * into r from public.rounds where id = d.round_id;
  update public.debts set status = 'settled', settled_via = 'cash', settled_by = uid,
    settled_at = now() where id = d.id;
  if d.penalty_amount > 0 then
    insert into public.platform_earnings (group_id, kind, amount, round_id, user_id)
    values (g.id, 'late_penalty', d.penalty_amount, d.round_id, d.user_id);
  end if;
  perform private.audit(uid, 'cash_recorded',
    format('a enregistré le remboursement de %s de %s (impayé du tour %s) — %s',
      private.format_amount(d.amount + d.penalty_amount), private.full_name(d.user_id),
      r.number, g.name), g.id);
  perform private.notify(d.user_id, 'debt', 'Dette remboursée',
    format('%s : votre remboursement de %s (tour %s) est enregistré.', g.name,
      private.format_amount(d.amount + d.penalty_amount), r.number),
    '/groupes/' || g.id);
  perform private.notify_managers(g.id, 'debt', 'Dette remboursée',
    format('%s : %s a remboursé %s (tour %s) : à reverser aux bénéficiaires de ce tour.',
      g.name, private.full_name(d.user_id), private.format_amount(d.amount), r.number));
end;
$$;

revoke all on function public.debt_record_payment(uuid) from public, anon;
grant execute on function public.debt_record_payment(uuid) to authenticated;
