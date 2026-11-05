-- Étape 4 — Connexion : opérations atomiques sur les codes SMS et les PIN.
-- Appelées uniquement par les Edge Functions (service_role) ; les empreintes sont
-- calculées côté Edge Function (HMAC pour les codes, Argon2id pour les PIN).
--
-- Les essais sont comptés AVANT la vérification, dans une seule requête : même avec
-- des appels simultanés, on ne peut jamais tester plus de codes ou de PIN que permis.

-- ---------------------------------------------------------------------------
-- Codes SMS
-- ---------------------------------------------------------------------------

-- Enregistre un nouveau code (il remplace les précédents) si les limites le permettent.
-- Renvoie 'ok', 'rate_limited_phone' ou 'rate_limited_ip'.
create or replace function public.svc_otp_issue(
  p_phone text, p_code_hash text, p_ip inet, p_validity_minutes integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from private.auth_otps
      where phone = p_phone and created_at > now() - interval '1 hour') >= 5 then
    return 'rate_limited_phone';
  end if;
  if p_ip is not null and (select count(*) from private.auth_otps
      where ip = p_ip and created_at > now() - interval '1 hour') >= 20 then
    return 'rate_limited_ip';
  end if;
  update private.auth_otps set used_at = now() where phone = p_phone and used_at is null;
  insert into private.auth_otps (phone, code_hash, expires_at, ip)
  values (p_phone, p_code_hash, now() + make_interval(mins => p_validity_minutes), p_ip);
  return 'ok';
end;
$$;

-- Vérifie un code : 'ok', 'invalid' (essais restants), 'too_many', 'expired' ou 'none'.
-- Un code réussi ne resert pas ; au 5e échec, le code est annulé.
create or replace function public.svc_otp_check(p_phone text, p_code_hash text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  otp private.auth_otps;
begin
  select * into otp from private.auth_otps
  where phone = p_phone and used_at is null
  order by created_at desc limit 1
  for update;

  if not found then
    return 'none';
  end if;
  if otp.expires_at < now() then
    update private.auth_otps set used_at = now() where id = otp.id;
    return 'expired';
  end if;

  update private.auth_otps set attempts = attempts + 1 where id = otp.id;
  if otp.code_hash = p_code_hash then
    update private.auth_otps set used_at = now() where id = otp.id;
    return 'ok';
  end if;
  if otp.attempts + 1 >= 5 then
    update private.auth_otps set used_at = now() where id = otp.id;
    return 'too_many';
  end if;
  return 'invalid';
end;
$$;

-- ---------------------------------------------------------------------------
-- PIN
-- ---------------------------------------------------------------------------

-- Le compte a-t-il un PIN utilisable ?
create or replace function public.svc_pin_usable(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.auth_pins
    where user_id = p_user and pin_hash is not null and not must_reset
  )
$$;

-- Réserve un essai avant la vérification. Renvoie l'empreinte à comparer et le numéro
-- de l'essai, ou aucune ligne si le PIN est absent, à recréer ou déjà à la limite.
create or replace function public.svc_pin_begin_attempt(p_user uuid, p_max_attempts integer)
returns table (pin_hash text, attempt integer)
language sql
security definer
set search_path = ''
as $$
  update private.auth_pins p
  set failed_attempts = p.failed_attempts + 1
  where p.user_id = p_user and p.pin_hash is not null and not p.must_reset
    and p.failed_attempts < p_max_attempts
  returning p.pin_hash, p.failed_attempts
$$;

-- Résultat de la vérification. Succès : compteur à zéro. Échec au dernier essai permis :
-- PIN bloqué (seul un code SMS permet d'en créer un nouveau). Renvoie les essais restants.
create or replace function public.svc_pin_finish_attempt(
  p_user uuid, p_success boolean, p_max_attempts integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  used integer;
begin
  if p_success then
    update private.auth_pins set failed_attempts = 0 where user_id = p_user;
    return p_max_attempts;
  end if;
  select failed_attempts into used from private.auth_pins where user_id = p_user;
  if used >= p_max_attempts then
    update private.auth_pins set must_reset = true where user_id = p_user;
  end if;
  return greatest(p_max_attempts - used, 0);
end;
$$;

create or replace function public.svc_pin_save(p_user uuid, p_pin_hash text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.auth_pins (user_id, pin_hash, failed_attempts, must_reset)
  values (p_user, p_pin_hash, 0, false)
  on conflict (user_id) do update
    set pin_hash = excluded.pin_hash, failed_attempts = 0, must_reset = false
$$;

-- Remise à zéro par le super admin : le PIN devra être recréé après un code SMS.
create or replace function public.svc_pin_require_reset(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.auth_pins (user_id, pin_hash, must_reset)
  values (p_user, null, true)
  on conflict (user_id) do update set must_reset = true, failed_attempts = 0
$$;

-- Échecs de PIN récents depuis une adresse (essais d'un même PIN sur plusieurs comptes).
create or replace function public.svc_recent_pin_failures(p_ip inet)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.security_events
  where ip = p_ip and kind in ('pin_failed', 'pin_blocked')
    and at > now() - interval '1 hour'
$$;

revoke execute on function
  public.svc_otp_issue(text, text, inet, integer),
  public.svc_otp_check(text, text),
  public.svc_pin_usable(uuid),
  public.svc_pin_begin_attempt(uuid, integer),
  public.svc_pin_finish_attempt(uuid, boolean, integer),
  public.svc_pin_save(uuid, text),
  public.svc_pin_require_reset(uuid),
  public.svc_recent_pin_failures(inet)
from public, anon, authenticated;

grant execute on function
  public.svc_otp_issue(text, text, inet, integer),
  public.svc_otp_check(text, text),
  public.svc_pin_usable(uuid),
  public.svc_pin_begin_attempt(uuid, integer),
  public.svc_pin_finish_attempt(uuid, boolean, integer),
  public.svc_pin_save(uuid, text),
  public.svc_pin_require_reset(uuid),
  public.svc_recent_pin_failures(inet)
to service_role;

-- Les codes SMS de plus d'un jour n'ont plus d'utilité : purge par cron-daily.
create or replace function public.svc_purge_auth_otps()
returns integer
language sql
security definer
set search_path = ''
as $$
  with deleted as (
    delete from private.auth_otps where created_at < now() - interval '1 day' returning 1
  )
  select count(*)::integer from deleted
$$;

revoke execute on function public.svc_purge_auth_otps() from public, anon, authenticated;
grant execute on function public.svc_purge_auth_otps() to service_role;

-- Ferme toutes les sessions d'un compte (PIN réinitialisé, compte bloqué). Les jetons
-- d'accès déjà émis expirent d'eux-mêmes en 15 minutes au plus.
create or replace function public.svc_revoke_sessions(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.sessions where user_id = p_user
$$;

revoke execute on function public.svc_revoke_sessions(uuid) from public, anon, authenticated;
grant execute on function public.svc_revoke_sessions(uuid) to service_role;
