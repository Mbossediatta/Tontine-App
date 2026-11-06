-- Échange de tour entre deux membres : le demandeur propose, l'autre membre accepte, un admin
-- du groupe valide. Exception voulue au verrouillage de l'ordre après le démarrage. L'échange
-- porte sur une part (une adhésion par part) : chacune prend le tour et le rang de l'autre.
-- Seulement entre tours à venir du cycle en cours ; une part n'est engagée que dans une
-- demande en cours à la fois.

alter type public.audit_action add value if not exists 'swap_approved';

-- La table n'a encore jamais été remplie : les parts échangées deviennent obligatoires.
alter table public.swap_requests
  add column requester_membership_id uuid not null
    references public.memberships (id) on delete cascade,
  add column partner_membership_id uuid not null
    references public.memberships (id) on delete cascade;

create index swap_requests_parts_idx
  on public.swap_requests (requester_membership_id, partner_membership_id)
  where status in ('pending_partner', 'pending_admin');

-- Groupe verrouillé pendant la vérification : deux demandes ne peuvent pas se croiser.
create or replace function private.lock_active_group(p_group uuid)
returns public.groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.groups;
begin
  select * into g from public.groups where id = p_group for update;
  if not found then
    raise exception 'Ce groupe n’existe pas.' using errcode = 'P0002';
  end if;
  perform private.assert_group_open(g);
  if g.status <> 'active' then
    raise exception 'Le cycle doit être en cours.' using errcode = '22023';
  end if;
  return g;
end;
$$;

-- Les deux parts sont toujours actives, bénéficiaires de leur tour, et les deux tours sont à
-- venir dans le cycle en cours (un tour ouvert a déjà commencé à collecter).
create or replace function private.assert_swappable(
  g public.groups, p_round_a uuid, p_part_a uuid, p_round_b uuid, p_part_b uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.rounds r
      where r.id in (p_round_a, p_round_b) and r.group_id = g.id
        and r.cycle = g.current_cycle and r.status = 'upcoming'
        and r.recipient_type = 'members') <> 2 then
    raise exception 'Seuls des tours à venir peuvent être échangés.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.round_beneficiaries b
                 join public.memberships m on m.id = b.membership_id
                 where b.round_id = p_round_a and b.membership_id = p_part_a
                   and m.status = 'active')
    or not exists (select 1 from public.round_beneficiaries b
                   join public.memberships m on m.id = b.membership_id
                   where b.round_id = p_round_b and b.membership_id = p_part_b
                     and m.status = 'active') then
    raise exception 'Ces tours ont changé de bénéficiaire : l’échange n’est plus possible.'
      using errcode = '22023';
  end if;
end;
$$;

create or replace function private.require_swap(p_swap uuid)
returns public.swap_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.swap_requests;
begin
  select * into s from public.swap_requests where id = p_swap for update;
  if not found then
    raise exception 'Cette demande d’échange n’existe plus.' using errcode = 'P0002';
  end if;
  return s;
end;
$$;

create or replace function private.close_swap(p_swap uuid, p_status public.swap_status)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.swap_requests set status = p_status, decided_at = now() where id = p_swap;
$$;

-- Je propose mon tour `p_my_round` contre celui de `p_partner` au tour `p_partner_round`.
create or replace function public.swap_request(p_my_round uuid, p_partner_round uuid, p_partner uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  mine public.rounds := private.require_round(p_my_round);
  theirs public.rounds := private.require_round(p_partner_round);
  g public.groups := private.lock_active_group(mine.group_id);
  my_part uuid;
  their_part uuid;
  new_id uuid;
begin
  if theirs.group_id <> g.id or p_partner = uid or p_my_round = p_partner_round then
    raise exception 'Choisissez le tour d’un autre membre.' using errcode = '22023';
  end if;
  -- Avec plusieurs parts dans le même tour, la première dans l'ordre est échangée.
  select m.id into my_part
  from public.round_beneficiaries b join public.memberships m on m.id = b.membership_id
  where b.round_id = mine.id and m.user_id = uid and m.status = 'active'
  order by m.payout_order limit 1;
  if my_part is null then
    raise exception 'Ce tour n’est pas le vôtre.' using errcode = '42501';
  end if;
  select m.id into their_part
  from public.round_beneficiaries b join public.memberships m on m.id = b.membership_id
  where b.round_id = theirs.id and m.user_id = p_partner and m.status = 'active'
  order by m.payout_order limit 1;
  if their_part is null then
    raise exception 'Ce membre ne reçoit pas la cagnotte à ce tour.' using errcode = '22023';
  end if;
  perform private.assert_swappable(g, mine.id, my_part, theirs.id, their_part);
  if exists (select 1 from public.swap_requests s
             where s.status in ('pending_partner', 'pending_admin')
               and (s.requester_membership_id in (my_part, their_part)
                 or s.partner_membership_id in (my_part, their_part))) then
    raise exception 'Une demande d’échange est déjà en cours pour l’un de ces tours.'
      using errcode = '23505';
  end if;

  insert into public.swap_requests (group_id, cycle, requester_id, partner_id,
    requester_round_id, partner_round_id, requester_membership_id, partner_membership_id)
  values (g.id, g.current_cycle, uid, p_partner, mine.id, theirs.id, my_part, their_part)
  returning id into new_id;
  perform private.notify(p_partner, 'swap_request', 'Demande d’échange de tour',
    format('%s propose d’échanger son tour %s (%s) contre votre tour %s (%s).',
      private.full_name(uid), mine.number, to_char(mine.due_date, 'DD/MM/YYYY'),
      theirs.number, to_char(theirs.due_date, 'DD/MM/YYYY')),
    '/groupes/' || g.id);
  return new_id;
end;
$$;

-- Réponse du membre sollicité : un accord passe la demande à la validation des admins.
create or replace function public.swap_respond(p_swap uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  s public.swap_requests := private.require_swap(p_swap);
  g public.groups;
begin
  if s.partner_id <> uid then
    raise exception 'Cette demande ne vous est pas adressée.' using errcode = '42501';
  end if;
  if s.status <> 'pending_partner' then
    raise exception 'Cette demande est déjà traitée.' using errcode = '22023';
  end if;
  if not p_accept then
    perform private.close_swap(s.id, 'rejected');
    perform private.notify(s.requester_id, 'swap_rejected', 'Échange refusé',
      format('%s a refusé l’échange de tour.', private.full_name(uid)), '/groupes/' || s.group_id);
    return;
  end if;
  g := private.lock_active_group(s.group_id);
  perform private.assert_swappable(g, s.requester_round_id, s.requester_membership_id,
    s.partner_round_id, s.partner_membership_id);
  update public.swap_requests set status = 'pending_admin' where id = s.id;
  perform private.notify(s.requester_id, 'swap_accepted', 'Échange accepté',
    format('%s a accepté. Un administrateur doit maintenant valider.', private.full_name(uid)),
    '/groupes/' || g.id);
  perform private.notify_managers(g.id, 'swap_request', 'Échange de tour à valider',
    format('%s : %s et %s veulent échanger leurs tours.', g.name,
      private.full_name(s.requester_id), private.full_name(uid)));
end;
$$;

-- Validation par un admin du groupe : les deux parts échangent leur tour et leur rang.
create or replace function public.swap_decide(p_swap uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.swap_requests := private.require_swap(p_swap);
  g public.groups := private.require_group(s.group_id);
  uid uuid := private.require_manage(g);
  round_a public.rounds;
  round_b public.rounds;
begin
  if s.status <> 'pending_admin' then
    raise exception 'L’autre membre doit d’abord accepter.' using errcode = '22023';
  end if;
  if not p_approve then
    perform private.close_swap(s.id, 'rejected');
    insert into public.notifications (user_id, type, title, body, link)
    select x, 'swap_rejected', 'Échange refusé',
      format('%s : l’administrateur a refusé l’échange de tour.', g.name), '/groupes/' || g.id
    from unnest(array[s.requester_id, s.partner_id]) x;
    return;
  end if;
  g := private.lock_active_group(g.id);
  perform private.assert_swappable(g, s.requester_round_id, s.requester_membership_id,
    s.partner_round_id, s.partner_membership_id);

  update public.round_beneficiaries b
  set membership_id = case b.membership_id
    when s.requester_membership_id then s.partner_membership_id
    else s.requester_membership_id end
  where (b.round_id = s.requester_round_id and b.membership_id = s.requester_membership_id)
     or (b.round_id = s.partner_round_id and b.membership_id = s.partner_membership_id);
  -- Rang unique vérifié en fin de transaction : les deux rangs s'échangent d'un coup.
  update public.memberships m
  set payout_order = o.payout_order
  from (
    select a.id, b.payout_order from public.memberships a, public.memberships b
    where (a.id, b.id) in ((s.requester_membership_id, s.partner_membership_id),
                           (s.partner_membership_id, s.requester_membership_id))
  ) o
  where m.id = o.id;
  perform private.close_swap(s.id, 'approved');

  select * into round_a from public.rounds where id = s.requester_round_id;
  select * into round_b from public.rounds where id = s.partner_round_id;
  -- Le demandeur reçoit désormais au tour du partenaire, et inversement.
  perform private.notify(s.requester_id, 'swap_approved', 'Échange validé',
    format('%s : vous recevrez la cagnotte au tour %s (%s).', g.name, round_b.number,
      to_char(round_b.due_date, 'DD/MM/YYYY')), '/groupes/' || g.id);
  perform private.notify(s.partner_id, 'swap_approved', 'Échange validé',
    format('%s : vous recevrez la cagnotte au tour %s (%s).', g.name, round_a.number,
      to_char(round_a.due_date, 'DD/MM/YYYY')), '/groupes/' || g.id);
  perform private.audit(uid, 'swap_approved',
    format('a validé l’échange de tour entre %s (tour %s) et %s (tour %s) dans « %s »',
      private.full_name(s.requester_id), round_a.number,
      private.full_name(s.partner_id), round_b.number, g.name),
    g.id);
end;
$$;

-- Le demandeur retire sa demande tant qu'elle n'est pas traitée.
create or replace function public.swap_cancel(p_swap uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  s public.swap_requests := private.require_swap(p_swap);
begin
  if s.requester_id <> uid then
    raise exception 'Seul l’auteur de la demande peut l’annuler.' using errcode = '42501';
  end if;
  if s.status not in ('pending_partner', 'pending_admin') then
    raise exception 'Cette demande est déjà traitée.' using errcode = '22023';
  end if;
  perform private.close_swap(s.id, 'cancelled');
end;
$$;

do $grants$
declare
  fn text;
begin
  foreach fn in array array[
    'swap_request(uuid, uuid, uuid)', 'swap_respond(uuid, boolean)',
    'swap_decide(uuid, boolean)', 'swap_cancel(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end;
$grants$;
