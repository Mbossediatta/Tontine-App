-- Membres et administrateurs : actions du super admin.
-- Référence : tontine-pwa/src/services/mock/member.mock.ts et la partie « Administrateurs »
-- de admin.mock.ts (mêmes règles, mêmes messages).
--
-- Appelées par le frontend : blocage, déblocage, modification, suspension, retrait du rôle
-- et réattribution des groupes d'un admin. Appelées par les Edge Functions (service_role) :
-- création d'un compte participant (member-create) et changement de numéro après le code
-- SMS reçu sur le nouveau numéro (member-phone-change).

-- ---------------------------------------------------------------------------
-- Aides internes
-- ---------------------------------------------------------------------------

-- Compte gérable par le super admin : tout compte non supprimé, sauf un super admin.
create or replace function private.require_member(p_user uuid)
returns public.profiles
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target public.profiles;
begin
  select * into target from public.profiles where id = p_user;
  if not found or target.deleted_at is not null then
    raise exception 'Ce compte a été supprimé.' using errcode = 'P0002';
  end if;
  if target.global_role = 'super_admin' then
    raise exception 'Le compte du super administrateur ne se gère pas ici.' using errcode = '42501';
  end if;
  return target;
end;
$$;

-- Compte administrateur modifiable par le super admin.
create or replace function private.require_admin_target(p_user uuid)
returns public.profiles
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target public.profiles := private.require_member(p_user);
begin
  if target.global_role <> 'admin' then
    raise exception 'Ce compte n’est pas administrateur.' using errcode = '42501';
  end if;
  return target;
end;
$$;

-- Numéro sénégalais (9 chiffres commençant par 7), libre ou déjà à ce compte.
create or replace function private.checked_phone(p_phone text, p_owner uuid default null)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  clean_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if clean_phone !~ '^7[0-9]{8}$' then
    raise exception 'Numéro de téléphone invalide.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.profiles
    where profiles.phone = clean_phone and deleted_at is null
      and (p_owner is null or id <> p_owner)
  ) then
    raise exception 'Ce numéro est déjà utilisé par un autre compte.' using errcode = '23505';
  end if;
  return clean_phone;
end;
$$;

-- Prénom ou nom : lettres, espaces, tirets et apostrophes (comme auth-profile-create).
create or replace function private.checked_name(p_label text, p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  clean_value text := btrim(coalesce(p_value, ''));
begin
  perform private.inspect_input(p_label, clean_value);
  if char_length(clean_value) not between 2 and 40 then
    raise exception '% : entre 2 et 40 caractères.', p_label using errcode = '22023';
  end if;
  if clean_value !~ '^[[:alpha:]'' .-]+$' then
    raise exception '% : utilisez seulement des lettres, espaces, tirets et apostrophes.', p_label
      using errcode = '22023';
  end if;
  return clean_value;
end;
$$;

-- Ferme toutes les sessions d'un compte (bloqué ou suspendu).
create or replace function private.revoke_sessions(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.sessions where user_id = p_user
$$;

-- ---------------------------------------------------------------------------
-- Membres (super admin)
-- ---------------------------------------------------------------------------

create or replace function public.member_block(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_super_admin();
  target public.profiles := private.require_member(p_user);
begin
  update public.profiles set is_suspended = true where id = target.id;
  perform private.revoke_sessions(target.id);
  perform private.audit(uid, 'member_blocked',
    format('a bloqué le compte de %s %s', target.first_name, target.last_name));
end;
$$;

create or replace function public.member_unblock(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_super_admin();
  target public.profiles := private.require_member(p_user);
begin
  update public.profiles set is_suspended = false where id = target.id;
  perform private.audit(uid, 'member_unblocked',
    format('a débloqué le compte de %s %s', target.first_name, target.last_name));
end;
$$;

-- Création d'un compte participant (Edge Function member-create, après création du compte
-- Supabase Auth). À sa 1re connexion : code SMS, puis création du PIN.
create or replace function public.svc_member_create(
  p_actor uuid, p_user uuid, p_phone text, p_first_name text, p_last_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_phone text;
  clean_first text := private.checked_name('Prénom', p_first_name);
  clean_last text := private.checked_name('Nom', p_last_name);
begin
  if not exists (
    select 1 from public.profiles
    where id = p_actor and global_role = 'super_admin' and not is_suspended and deleted_at is null
  ) then
    raise exception 'Action réservée au super administrateur.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.profiles
    where profiles.phone = regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')
      and deleted_at is null
  ) then
    raise exception 'Un compte existe déjà avec ce numéro.' using errcode = '23505';
  end if;
  clean_phone := private.checked_phone(p_phone);
  insert into public.profiles (id, first_name, last_name, phone, global_role)
  values (p_user, clean_first, clean_last, clean_phone, 'user');
  perform private.audit(p_actor, 'member_created',
    format('a créé le compte de %s %s', clean_first, clean_last));
  return p_user;
end;
$$;

-- Changement de numéro (Edge Function member-phone-change, après vérification du code SMS
-- envoyé au NOUVEAU numéro). Le numéro de reversement suivait l'ancien : il suit aussi.
create or replace function public.svc_phone_change(p_actor uuid, p_user uuid, p_phone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.profiles;
  clean_phone text;
begin
  if not exists (
    select 1 from public.profiles
    where id = p_actor and global_role = 'super_admin' and not is_suspended and deleted_at is null
  ) then
    raise exception 'Action réservée au super administrateur.' using errcode = '42501';
  end if;
  select * into target from public.profiles where id = p_user;
  if not found or target.deleted_at is not null then
    raise exception 'Ce compte a été supprimé.' using errcode = 'P0002';
  end if;
  if target.global_role = 'super_admin' then
    raise exception 'Le compte du super administrateur ne se gère pas ici.' using errcode = '42501';
  end if;
  if regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') = target.phone then
    raise exception 'C’est déjà son numéro actuel.' using errcode = '22023';
  end if;
  clean_phone := private.checked_phone(p_phone, target.id);
  update public.profiles
  set phone = clean_phone,
    payout_phone = case when payout_phone = target.phone then clean_phone else payout_phone end
  where id = target.id;
  perform private.audit(p_actor, 'phone_changed',
    format('a changé le numéro de %s %s', target.first_name, target.last_name));
end;
$$;

-- ---------------------------------------------------------------------------
-- Administrateurs (super admin)
-- ---------------------------------------------------------------------------

create or replace function public.admin_update(
  p_user uuid, p_first_name text, p_last_name text, p_phone text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_super_admin();
  target public.profiles := private.require_admin_target(p_user);
  clean_first text := private.checked_name('Prénom', p_first_name);
  clean_last text := private.checked_name('Nom', p_last_name);
  clean_phone text := private.checked_phone(p_phone, p_user);
begin
  update public.profiles
  set first_name = clean_first, last_name = clean_last, phone = clean_phone
  where id = target.id;
  perform private.audit(uid, 'admin_updated',
    format('a modifié le compte de %s %s', clean_first, clean_last));
end;
$$;

create or replace function public.admin_suspend(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_super_admin();
  target public.profiles := private.require_admin_target(p_user);
begin
  update public.profiles set is_suspended = true where id = target.id;
  perform private.revoke_sessions(target.id);
  perform private.audit(uid, 'admin_suspended',
    format('a suspendu le compte de %s %s', target.first_name, target.last_name));
end;
$$;

create or replace function public.admin_reactivate(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_super_admin();
  target public.profiles := private.require_admin_target(p_user);
begin
  update public.profiles set is_suspended = false where id = target.id;
  perform private.audit(uid, 'admin_reactivated',
    format('a réactivé le compte de %s %s', target.first_name, target.last_name));
end;
$$;

-- Retire le rôle d'administrateur (il redevient participant). Un groupe ne doit jamais
-- rester sans administrateur responsable : ses groupes sont réattribués avant.
create or replace function public.admin_revoke(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_super_admin();
  target public.profiles := private.require_admin_target(p_user);
  responsible integer;
begin
  select count(*) into responsible from public.groups
  where admin_id = target.id and archived_at is null;
  if responsible > 0 then
    raise exception 'Réattribuez d’abord ses % à un autre administrateur.',
      private.plural(responsible, 'groupe') using errcode = '23505';
  end if;
  update public.profiles set global_role = 'user' where id = target.id;
  delete from public.community_admins where admin_id = target.id;
  perform private.audit(uid, 'admin_deleted',
    format('a retiré le rôle administrateur à %s %s', target.first_name, target.last_name));
end;
$$;

-- Confie tous les groupes dont p_from est responsable à p_to ; renvoie leur nombre.
create or replace function public.admin_reassign_groups(p_from uuid, p_to uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_super_admin();
  from_admin public.profiles := private.require_admin_target(p_from);
  to_admin public.profiles := private.require_admin_target(p_to);
  moved integer;
begin
  if from_admin.id = to_admin.id then
    raise exception 'Choisissez un autre administrateur.' using errcode = '22023';
  end if;
  if to_admin.is_suspended then
    raise exception 'Cet administrateur est suspendu.' using errcode = '22023';
  end if;
  -- L'ancien admin reste membre s'il cotisait, mais perd ses droits de gestion.
  update public.memberships m set role = 'member'
  where m.user_id = from_admin.id and m.role in ('owner', 'co_admin')
    and m.group_id in (select g.id from public.groups g where g.admin_id = from_admin.id);
  update public.groups set admin_id = to_admin.id where admin_id = from_admin.id;
  get diagnostics moved = row_count;
  perform private.notify(to_admin.id, 'admin', 'Nouveaux groupes à gérer',
    format('%s par le super administrateur.',
      private.plural(moved, 'groupe vous a été confié', 'groupes vous ont été confiés')),
    '/admin');
  perform private.audit(uid, 'groups_reassigned',
    format('a confié les %s de %s %s à %s %s', private.plural(moved, 'groupe'),
      from_admin.first_name, from_admin.last_name, to_admin.first_name, to_admin.last_name));
  return moved;
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
    'member_block(uuid)', 'member_unblock(uuid)', 'admin_update(uuid, text, text, text)',
    'admin_suspend(uuid)', 'admin_reactivate(uuid)', 'admin_revoke(uuid)',
    'admin_reassign_groups(uuid, uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
  foreach fn in array array[
    'svc_member_create(uuid, uuid, text, text, text)', 'svc_phone_change(uuid, uuid, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end;
$grants$;
