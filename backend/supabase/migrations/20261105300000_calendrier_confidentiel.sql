-- Calendrier confidentiel : un membre voit les dates de tous les tours, mais ne sait pas qui
-- reçoit la cagnotte aux tours des autres. Seuls ses propres tours portent son nom ; les
-- administrateurs du groupe voient tout. L'échange de tour se demande donc sur un tour
-- anonyme : le serveur retrouve le membre concerné, et le demandeur n'apprend pas son nom.

-- Bénéficiaires d'un tour : mes parts, ou toutes si je gère le groupe.
drop policy round_beneficiaries_select on public.round_beneficiaries;
create policy round_beneficiaries_select on public.round_beneficiaries
  for select to authenticated
  using (
    exists (
      select 1 from public.memberships m
      where m.id = round_beneficiaries.membership_id
        and m.user_id = (select private.active_uid())
    )
    or exists (
      select 1 from public.rounds r
      where r.id = round_beneficiaries.round_id and private.can_manage_group(r.group_id)
    )
  );

-- Le rang de passage d'une part révèle son tour : il n'est plus lisible directement
-- (group_order_view le donne à qui a le droit de le voir).
revoke select on public.memberships from authenticated;
grant select (id, group_id, user_id, role, status, joined_at) on public.memberships to authenticated;

-- Ordre de passage visible par la personne connectée : le rang de ses parts (de toutes les
-- parts si elle gère le groupe), et le nombre de bénéficiaires de chaque tour, qui fixe la
-- part de cagnotte de chacun.
create or replace function public.group_order_view(p_groups uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object('membershipId', m.id, 'payoutOrder', m.payout_order))
      from public.memberships m
      where m.group_id = any (p_groups)
        and m.payout_order is not null
        and (m.user_id = private.active_uid() or private.can_manage_group(m.group_id))
    ), '[]'::jsonb),
    'beneficiaryCounts', coalesce((
      select jsonb_object_agg(r.id, (select count(*) from public.round_beneficiaries b
                                     where b.round_id = r.id))
      from public.rounds r
      where r.group_id = any (p_groups) and private.can_view_group(r.group_id)
    ), '{}'::jsonb)
  )
$$;

revoke all on function public.group_order_view(uuid[]) from public, anon;
grant execute on function public.group_order_view(uuid[]) to authenticated;

-- Demande d'échange sur un tour anonyme : sans `p_partner`, le membre de ce tour est retrouvé
-- par le serveur (la première part dans l'ordre qui n'est pas la mienne).
drop function public.swap_request(uuid, uuid, uuid);
create function public.swap_request(
  p_my_round uuid, p_partner_round uuid, p_partner uuid default null
)
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
  partner uuid := p_partner;
  my_part uuid;
  their_part uuid;
  new_id uuid;
begin
  if partner is null then
    select m.user_id into partner
    from public.round_beneficiaries b join public.memberships m on m.id = b.membership_id
    where b.round_id = theirs.id and m.user_id <> uid and m.status = 'active'
    order by m.payout_order limit 1;
  end if;
  if theirs.group_id <> g.id or partner is null or partner = uid or p_my_round = p_partner_round then
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
  where b.round_id = theirs.id and m.user_id = partner and m.status = 'active'
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
  values (g.id, g.current_cycle, uid, partner, mine.id, theirs.id, my_part, their_part)
  returning id into new_id;
  perform private.notify(partner, 'swap_request', 'Demande d’échange de tour',
    format('%s propose d’échanger son tour %s (%s) contre votre tour %s (%s).',
      private.full_name(uid), mine.number, to_char(mine.due_date, 'DD/MM/YYYY'),
      theirs.number, to_char(theirs.due_date, 'DD/MM/YYYY')),
    '/groupes/' || g.id);
  return new_id;
end;
$$;

revoke all on function public.swap_request(uuid, uuid, uuid) from public, anon;
grant execute on function public.swap_request(uuid, uuid, uuid) to authenticated;

-- Réponse du membre sollicité : le demandeur est prévenu sans apprendre son nom.
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
  their_round integer := (select number from public.rounds where id = s.partner_round_id);
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
      format('Le membre du tour %s a refusé l’échange de tour.', their_round),
      '/groupes/' || s.group_id);
    return;
  end if;
  g := private.lock_active_group(s.group_id);
  perform private.assert_swappable(g, s.requester_round_id, s.requester_membership_id,
    s.partner_round_id, s.partner_membership_id);
  update public.swap_requests set status = 'pending_admin' where id = s.id;
  perform private.notify(s.requester_id, 'swap_accepted', 'Échange accepté',
    format('Le membre du tour %s a accepté. Un administrateur doit maintenant valider.',
      their_round),
    '/groupes/' || g.id);
  perform private.notify_managers(g.id, 'swap_request', 'Échange de tour à valider',
    format('%s : %s et %s veulent échanger leurs tours.', g.name,
      private.full_name(s.requester_id), private.full_name(uid)));
end;
$$;
