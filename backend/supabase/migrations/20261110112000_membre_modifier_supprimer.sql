-- Super admin : modifier ou supprimer le compte d'un membre.
--
-- - Modifier : prénom et nom (le numéro se change déjà par « Changer le numéro »).
-- - Supprimer : le compte est anonymisé, jamais effacé. Ses paiements, tours et reçus
--   restent exacts pour les autres membres et s'affichent « Compte supprimé ». Le numéro
--   est libéré (il pourra servir à une nouvelle inscription) et la connexion est coupée.
--   Refusé tant que le membre participe à un groupe en cours (en préparation, actif ou
--   suspendu), qu'il en est l'administrateur, qu'il doit encore de l'argent, ou qu'il a
--   un rôle dans une organisation (AFP…).

alter type public.audit_action add value if not exists 'member_updated';
alter type public.audit_action add value if not exists 'member_deleted';

create or replace function public.member_update(p_user uuid, p_first_name text, p_last_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_super_admin();
  target public.profiles := private.require_member(p_user);
  v_first text := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last text := nullif(btrim(coalesce(p_last_name, '')), '');
begin
  perform private.inspect_input('first_name', v_first);
  perform private.inspect_input('last_name', v_last);
  if v_first is null or char_length(v_first) not between 2 and 40
     or v_last is null or char_length(v_last) not between 2 and 40 then
    raise exception 'Prénom et nom : entre 2 et 40 caractères chacun.' using errcode = '22023';
  end if;
  update public.profiles set first_name = v_first, last_name = v_last where id = target.id;
  perform private.audit(uid, 'member_updated',
    format('a renommé %s %s en %s %s', target.first_name, target.last_name, v_first, v_last));
end;
$$;

create or replace function public.member_delete(p_user uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_super_admin();
  target public.profiles := private.require_member(p_user);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_group text;
begin
  perform private.inspect_input('reason', v_reason);
  if v_reason is null or char_length(v_reason) < 3 or char_length(v_reason) > 200 then
    raise exception 'Indiquez le motif de la suppression (200 caractères au plus).'
      using errcode = '22023';
  end if;

  select g.name into v_group
  from public.memberships m join public.groups g on g.id = m.group_id
  where m.user_id = target.id and m.status in ('pending', 'active')
    and g.status in ('draft', 'active', 'suspended')
  limit 1;
  if v_group is not null then
    raise exception 'Ce membre participe encore au groupe « % ». Retirez-le du groupe, ou attendez la fin de la tontine.', v_group
      using errcode = '22023';
  end if;
  if exists (select 1 from public.debts d where d.user_id = target.id and d.status = 'open') then
    raise exception 'Ce membre a encore une dette en cours : elle doit être réglée avant la suppression.'
      using errcode = '22023';
  end if;
  if exists (select 1 from public.organization_roles r where r.user_id = target.id)
     or exists (select 1 from public.structure_roles r where r.user_id = target.id) then
    raise exception 'Ce membre a un rôle dans une organisation : retirez-lui ce rôle d’abord.'
      using errcode = '22023';
  end if;

  perform private.revoke_sessions(target.id);
  delete from public.push_subscriptions where user_id = target.id;
  delete from private.auth_pins where user_id = target.id;
  update public.organization_members set status = 'left' where user_id = target.id;
  update public.structure_members set status = 'left', left_at = coalesce(left_at, now())
  where user_id = target.id and status in ('pending', 'active');
  update public.profiles
  set first_name = 'Compte', last_name = 'supprimé', phone = null, payout_phone = null,
      payout_method = null, avatar_url = null, is_suspended = true, deleted_at = now()
  where id = target.id;
  update auth.users set banned_until = 'infinity' where id = target.id;

  perform private.audit(uid, 'member_deleted',
    format('a supprimé le compte de %s %s (%s) : %s', target.first_name, target.last_name,
      target.phone, v_reason));
end;
$$;

revoke all on function public.member_update(uuid, text, text), public.member_delete(uuid, text)
  from public, anon;
grant execute on function public.member_update(uuid, text, text), public.member_delete(uuid, text)
  to authenticated;
