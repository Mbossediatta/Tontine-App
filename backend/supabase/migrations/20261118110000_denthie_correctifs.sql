-- Correctifs du Denthie (…_denthie.sql), décidés le 18 novembre 2026 :
-- 1. Retrait d'urgence : une part retirée perd aussi son numéro (contrainte
--    memberships_order_only_active), sinon le retrait échouait.
-- 2. Pas de « parts » dans un Denthie : chaque membre a une seule épargne.
-- 3. Messages : on parle d'épargne, plus de « tours » ni de « cagnottes » (onglet Épargne).

create or replace function private.denthie_one_share()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active'
     and exists (select 1 from public.groups where id = new.group_id and kind = 'denthie')
     and exists (
       select 1 from public.memberships
       where group_id = new.group_id and user_id = new.user_id and status = 'active'
         and id <> new.id
     ) then
    raise exception 'Dans un Denthie, chaque membre a une seule épargne.' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger memberships_denthie_one_share
before insert or update of status on public.memberships
for each row execute function private.denthie_one_share();

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
      format('%s : envoyez %s à %s (Épargne → Épargnes à envoyer).', g.name,
        private.format_amount(sent), private.full_name(p_user)));
  end if;
  perform private.audit(uid, 'denthie_withdrawal',
    format('a accordé un retrait d’urgence de %s à %s (« %s ») — %s',
      private.format_amount(coalesce(sent, 0)), private.full_name(p_user), reason, g.name), g.id);
end;
$$;

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
    format('%s : envoyez maintenant à chaque membre son épargne (Épargne → Épargnes à envoyer).', g.name));
  perform private.audit(uid, 'denthie_distribution',
    format('a validé la répartition de %s — %s', private.format_amount(total), g.name), g.id);
  return 'paid';
end;
$$;

-- Membre ajouté par l'admin : dans un Denthie, pas de « parts » dans le message.
create or replace function public.membership_add_by_phone(
  p_group uuid, p_phone text, p_share_count integer default 1
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.groups := private.require_group(p_group);
  target uuid;
  already_active boolean;
  pending_id uuid;
  to_create integer;
begin
  perform private.require_manage(g);
  if g.status <> 'draft' then
    raise exception 'Le cycle a déjà démarré.' using errcode = '22023';
  end if;
  if p_share_count is null or p_share_count < 1 or p_share_count > g.max_members then
    raise exception 'Le nombre de parts doit être compris entre 1 et la capacité du groupe.'
      using errcode = '22023';
  end if;
  select id into target from public.profiles
  where phone = regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') and deleted_at is null;
  if target is null then
    raise exception 'Aucun compte avec ce numéro. Partagez le lien d’invitation pour qu’il s’inscrive.'
      using errcode = 'P0002';
  end if;
  already_active := exists (select 1 from public.memberships
    where group_id = g.id and user_id = target and status = 'active');
  select id into pending_id from public.memberships
  where group_id = g.id and user_id = target and status = 'pending';
  to_create := case when already_active then p_share_count
    else greatest(0, p_share_count - case when pending_id is null then 0 else 1 end) end;
  perform private.assert_room(g, to_create + case when pending_id is null then 0 else 1 end);
  if pending_id is not null then
    update public.memberships set status = 'active', joined_at = now() where id = pending_id;
  end if;
  insert into public.memberships (group_id, user_id, role, status)
  select g.id, target, 'member', 'active' from generate_series(1, to_create);
  perform private.notify(target, 'added',
    case when already_active then 'Parts supplémentaires ajoutées' else 'Ajouté à un groupe' end,
    case when already_active
      then format('%s part(s) supplémentaire(s) vous ont été attribuée(s) dans %s.', p_share_count, g.name)
      when g.kind = 'denthie' then format('Vous faites partie de « %s » : vous y épargnez à chaque période.', g.name)
      else format('Vous faites partie de %s avec %s part(s).', g.name, p_share_count) end,
    '/groupes/' || g.id);
  return p_share_count;
end;
$$;
