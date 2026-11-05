-- Conditions d'utilisation et politique de confidentialité : acceptation obligatoire.
-- 1re connexion (création du PIN, Edge Function auth-pin-set) : la case à cocher.
-- Textes modifiés dans Paramètres : la version augmente et chacun les accepte de nouveau.
-- Preuve conservée en ajout seul : qui, quelle version, quand, depuis quel appareil.

-- Version des textes, dans les paramètres de l'application (1 au départ).
update public.platform_settings
set app = app || jsonb_build_object('termsVersion', coalesce((app ->> 'termsVersion')::int, 1));

-- Dernière version acceptée par la personne (null : jamais). Hors des colonnes que
-- l'utilisateur peut modifier lui-même (grant de rls.sql) : seules nos fonctions l'écrivent.
alter table public.profiles add column terms_version integer;

create table public.terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  version integer not null check (version >= 1),
  accepted_at timestamptz not null default now(),
  user_agent text check (char_length(user_agent) <= 400)
);

create index terms_acceptances_user_idx on public.terms_acceptances (user_id, accepted_at desc);

create trigger terms_acceptances_append_only
  before update on public.terms_acceptances
  for each row execute function private.forbid_change();

alter table public.terms_acceptances enable row level security;
grant select on public.terms_acceptances to authenticated;

create policy terms_acceptances_select on public.terms_acceptances
  for select to authenticated
  using (user_id = (select private.active_uid()) or (select private.is_super_admin()));

-- Les textes changent : la version augmente (quel que soit le chemin d'écriture).
create or replace function private.bump_terms_version()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  previous integer := coalesce((old.app ->> 'termsVersion')::int, 1);
begin
  new.app := new.app || jsonb_build_object(
    'termsVersion',
    case
      when new.app ->> 'termsText' is distinct from old.app ->> 'termsText'
        or new.app ->> 'privacyText' is distinct from old.app ->> 'privacyText'
      then previous + 1
      else previous
    end
  );
  return new;
end;
$$;

create trigger platform_settings_terms_version
  before update of app on public.platform_settings
  for each row execute function private.bump_terms_version();

create or replace function private.current_terms_version()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((s.app ->> 'termsVersion')::int, 1) from public.platform_settings s
$$;

-- Enregistre l'acceptation : seulement la version en vigueur (textes lus à l'écran).
create or replace function private.record_terms(p_user uuid, p_version integer, p_user_agent text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_version is distinct from private.current_terms_version() then
    raise exception 'Les conditions ont été mises à jour. Relisez-les avant de les accepter.'
      using errcode = '23505';
  end if;
  insert into public.terms_acceptances (user_id, version, user_agent)
  values (p_user, p_version, left(nullif(btrim(coalesce(p_user_agent, '')), ''), 400));
  update public.profiles set terms_version = p_version where id = p_user;
end;
$$;

-- Textes à lire avant d'accepter : publics (écran du PIN, avant toute session).
create or replace function public.legal_terms()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'version', private.current_terms_version(),
    'termsText', s.app ->> 'termsText',
    'privacyText', s.app ->> 'privacyText'
  )
  from public.platform_settings s
$$;

-- Personne connectée : version en vigueur et version qu'elle a acceptée.
create or replace function public.terms_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('current', private.current_terms_version(), 'accepted', p.terms_version)
  from public.profiles p
  where p.id = private.active_uid()
$$;

create or replace function public.terms_accept(p_version integer, p_user_agent text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.active_uid();
begin
  if uid is null then
    raise exception 'Session expirée, reconnectez-vous.' using errcode = '42501';
  end if;
  perform private.record_terms(uid, p_version, p_user_agent);
end;
$$;

-- Edge Function auth-pin-set (rôle service) : l'acceptation cochée sur l'écran du PIN.
create or replace function public.svc_terms_accept(p_user uuid, p_version integer, p_user_agent text)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.record_terms(p_user, p_version, p_user_agent);
$$;

-- Edge Functions : la personne doit-elle (encore) accepter les conditions ?
create or replace function public.svc_terms_due(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p.terms_version is not distinct from private.current_terms_version() then null
    else private.current_terms_version()
  end
  from public.profiles p
  where p.id = p_user
$$;

revoke all on function public.legal_terms(), public.terms_status(),
  public.terms_accept(integer, text), public.svc_terms_accept(uuid, integer, text),
  public.svc_terms_due(uuid) from public;
grant execute on function public.legal_terms() to anon, authenticated;
grant execute on function public.terms_status(), public.terms_accept(integer, text) to authenticated;
grant execute on function public.svc_terms_accept(uuid, integer, text), public.svc_terms_due(uuid)
  to service_role;
