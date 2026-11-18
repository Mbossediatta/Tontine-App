-- Correctif du retrait d'urgence d'un Denthie (…_denthie.sql) : une part retirée perd aussi
-- son numéro (contrainte memberships_order_only_active), sinon le retrait échouait.

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
