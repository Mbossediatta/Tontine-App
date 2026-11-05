-- Paramètres de la plateforme (super admin) et clé secrète PayTech dans le coffre-fort.
-- Section 4.11 du cahier : clés secrètes en écriture seule (Supabase Vault), jamais
-- relues par le navigateur ; la page ne reçoit qu'un indice (« •••• 3f9a »).
-- Référence : tontine-pwa/src/services/mock/settings.mock.ts (type PlatformSettings).

-- Paramètres tels que la page les affiche ; modèles de messages : le français (le wolof est
-- gardé tel quel en base, à faire relire avant tout envoi).
create or replace function public.settings_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.platform_settings;
begin
  perform private.require_super_admin();
  select * into s from public.platform_settings;
  return jsonb_build_object(
    'payment', s.payment,
    'rules', s.rules,
    'security', s.security,
    'sms', s.sms,
    'app', s.app,
    'templates', coalesce(s.templates -> 'fr', '{}'::jsonb)
  );
end;
$$;

create or replace function private.require_number(
  p_values jsonb, p_key text, p_label text, p_min numeric, p_max numeric
)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  value numeric;
begin
  begin
    value := (p_values ->> p_key)::numeric;
  exception when others then
    value := null;
  end;
  if value is null or value < p_min or value > p_max then
    raise exception '% : entre % et %.', p_label, p_min, p_max using errcode = '22023';
  end if;
  return value;
end;
$$;

create or replace function private.require_text(
  p_values jsonb, p_key text, p_label text, p_min integer, p_max integer
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  value text := btrim(coalesce(p_values ->> p_key, ''));
begin
  if char_length(value) < p_min or char_length(value) > p_max then
    raise exception '% : entre % et % caractères.', p_label, p_min, p_max using errcode = '22023';
  end if;
  perform private.inspect_input(p_label, value);
  return value;
end;
$$;

-- Enregistre une section ; `p_new_secret` remplace la clé secrète PayTech (section
-- « payment ») : elle va dans le coffre-fort, seul son indice reste dans les paramètres.
create or replace function public.settings_update(
  p_section text, p_values jsonb, p_new_secret text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_super_admin();
  s public.platform_settings;
  secret text := nullif(btrim(coalesce(p_new_secret, '')), '');
  section_value jsonb;
  min_amount numeric;
  secret_id uuid;
begin
  select * into s from public.platform_settings for update;
  if p_values is null or jsonb_typeof(p_values) <> 'object' then
    raise exception 'Les paramètres transmis sont invalides.' using errcode = '22023';
  end if;
  if secret is not null and p_section <> 'payment' then
    raise exception 'La clé Orange SMS se règle dans les secrets du serveur (plusieurs identifiants sont nécessaires).'
      using errcode = '22023';
  end if;

  case p_section
    when 'payment' then
      if p_values ->> 'mode' not in ('test', 'prod') then
        raise exception 'Mode de paiement : test ou prod.' using errcode = '22023';
      end if;
      section_value := jsonb_build_object(
        'provider', private.require_text(p_values, 'provider', 'Prestataire', 2, 40),
        'publicKey', private.require_text(p_values, 'publicKey', 'Clé API', 0, 200),
        'secretKeyHint', s.payment -> 'secretKeyHint',
        'feePercent', private.require_number(p_values, 'feePercent', 'Frais de paiement (%)', 0, 10),
        'mode', p_values ->> 'mode');
      if secret is not null then
        if char_length(secret) < 8 then
          raise exception 'Cette clé paraît trop courte.' using errcode = '22023';
        end if;
        select id into secret_id from vault.secrets where name = 'paytech_api_secret';
        if secret_id is null then
          perform vault.create_secret(secret, 'paytech_api_secret', 'Clé secrète PayTech (API_SECRET)');
        else
          perform vault.update_secret(secret_id, secret);
        end if;
        section_value := section_value
          || jsonb_build_object('secretKeyHint', '•••• ' || right(secret, 4));
        perform private.audit(uid, 'settings_updated',
          'a remplacé la clé secrète du service de paiement');
      end if;
      update public.platform_settings set payment = section_value, updated_by = uid where id;
    when 'rules' then
      min_amount := private.require_number(p_values, 'minContribution', 'Cotisation minimale', 100, 1000000);
      section_value := jsonb_build_object(
        'graceDays', private.require_number(p_values, 'graceDays', 'Délai de grâce (jours)', 0, 30),
        'defaultLatePenalty',
          private.require_number(p_values, 'defaultLatePenalty', 'Pénalité par défaut', 0, 1000000),
        'minContribution', min_amount,
        'maxContribution',
          private.require_number(p_values, 'maxContribution', 'Cotisation maximale', min_amount, 10000000),
        'maxMembers', private.require_number(p_values, 'maxMembers', 'Parts par groupe', 2, 500));
      update public.platform_settings set rules = section_value, updated_by = uid where id;
    when 'security' then
      section_value := jsonb_build_object(
        'otpValidityMinutes',
          private.require_number(p_values, 'otpValidityMinutes', 'Validité du code SMS (minutes)', 2, 30),
        'maxPinAttempts', private.require_number(p_values, 'maxPinAttempts', 'Essais du PIN', 3, 10),
        'inactivityLockMinutes',
          private.require_number(p_values, 'inactivityLockMinutes', 'Verrouillage (minutes)', 1, 120));
      update public.platform_settings set security = section_value, updated_by = uid where id;
    when 'sms' then
      section_value := jsonb_build_object(
        'provider', private.require_text(p_values, 'provider', 'Fournisseur', 2, 40),
        'senderName', private.require_text(p_values, 'senderName', 'Nom d’expéditeur', 2, 11),
        'apiKeyHint', s.sms -> 'apiKeyHint',
        'costPerSms', private.require_number(p_values, 'costPerSms', 'Coût d’un SMS', 0, 1000));
      update public.platform_settings set sms = section_value, updated_by = uid where id;
    when 'app' then
      section_value := jsonb_build_object(
        'name', private.require_text(p_values, 'name', 'Nom de l’application', 2, 60),
        'supportPhone', private.checked_phone_format(p_values ->> 'supportPhone'),
        'termsText', private.require_text(p_values, 'termsText', 'Conditions', 10, 5000),
        'privacyText', private.require_text(p_values, 'privacyText', 'Confidentialité', 10, 5000));
      update public.platform_settings set app = section_value, updated_by = uid where id;
    when 'templates' then
      section_value := jsonb_build_object(
        'reminder', private.require_text(p_values, 'reminder', 'Modèle « rappel »', 10, 320),
        'late', private.require_text(p_values, 'late', 'Modèle « retard »', 10, 320),
        'payment', private.require_text(p_values, 'payment', 'Modèle « paiement »', 10, 320),
        'payout', private.require_text(p_values, 'payout', 'Modèle « versement »', 10, 320));
      update public.platform_settings
      set templates = jsonb_set(s.templates, '{fr}', section_value), updated_by = uid where id;
    else
      raise exception 'Section de paramètres inconnue.' using errcode = '22023';
  end case;

  perform private.audit(uid, 'settings_updated', format('a modifié les paramètres « %s »', p_section));
end;
$$;

-- Numéro au format sénégalais (sans vérifier s'il appartient à un compte).
create or replace function private.checked_phone_format(p_phone text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  clean_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if clean_phone !~ '^7[0-9]{8}$' then
    raise exception 'Numéro de téléphone invalide.' using errcode = '22023';
  end if;
  return clean_phone;
end;
$$;

-- Clés PayTech pour les Edge Functions : clé API des paramètres, clé secrète du coffre-fort.
create or replace function public.svc_paytech_keys()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'apiKey', nullif(btrim(coalesce((select s.payment ->> 'publicKey' from public.platform_settings s), '')), ''),
    'apiSecret', (select decrypted_secret from vault.decrypted_secrets where name = 'paytech_api_secret')
  )
$$;

revoke all on function public.settings_get() from public, anon;
grant execute on function public.settings_get() to authenticated;
revoke all on function public.settings_update(text, jsonb, text) from public, anon;
grant execute on function public.settings_update(text, jsonb, text) to authenticated;
revoke all on function public.svc_paytech_keys() from public, anon, authenticated;
grant execute on function public.svc_paytech_keys() to service_role;
revoke execute on all functions in schema private from public;
grant execute on function
  private.active_uid(), private.is_super_admin(), private.can_manage_group(uuid),
  private.can_view_group(uuid), private.manages_person(uuid), private.is_community_admin(uuid)
to authenticated;
