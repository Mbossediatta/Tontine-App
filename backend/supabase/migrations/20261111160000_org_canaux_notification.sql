-- Canaux de notification des organisations (cahier AFP § 9.3) : en plus des notifications
-- dans l'appli et des alertes push, les RAPPELS de cotisation partent aussi par SMS (le même
-- compte Orange que les codes de connexion) et par courriel (SMTP), si l'organisation l'a
-- activé dans ses paramètres. Chaque envoi est tracé avec son état de livraison.
-- Fonctionnement : un rappel créé → les envois SMS / courriel sont mis en file
-- (org_deliveries) → toutes les 5 minutes, la fonction org-notify-send les envoie et note
-- le résultat (envoyé, échec, ignoré). Le membre qui a coupé les rappels dans son profil
-- n'en reçoit aucun.

-- Adresse électronique du membre dans l'organisation (cahier § 5.1), facultative.
alter table public.organization_members
  add column email text check (
    email is null or (char_length(email) <= 120 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'));

create table public.org_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  notification_id uuid references public.notifications (id) on delete set null,
  user_id uuid references public.profiles (id) on delete set null,
  channel text not null check (channel in ('sms', 'email')),
  destination text not null,
  subject text not null,
  body text not null,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index org_deliveries_queue_idx on public.org_deliveries (status, created_at)
  where status = 'queued';
create index org_deliveries_org_idx on public.org_deliveries (organization_id, created_at desc);
alter table public.org_deliveries enable row level security;

-- Un rappel de l'organisation vient d'être créé : SMS et courriel mis en file selon ses
-- réglages et les préférences du membre.
create or replace function private.org_queue_deliveries()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.organizations;
  p public.profiles;
  v_email text;
  v_settings jsonb;
begin
  select * into o from public.organizations
  where slug = split_part(coalesce(new.link, ''), '/', 3) and not is_suspended;
  if not found then
    return null;
  end if;
  v_settings := private.org_settings(o.id);
  select * into p from public.profiles where id = new.user_id and deleted_at is null;
  if not found or coalesce((p.notification_prefs ->> 'reminders')::boolean, true) = false then
    return null;
  end if;
  if (v_settings ->> 'reminderSms')::boolean and p.phone is not null then
    insert into public.org_deliveries (organization_id, notification_id, user_id, channel,
      destination, subject, body)
    values (o.id, new.id, p.id, 'sms', p.phone, new.title, new.body);
  end if;
  if (v_settings ->> 'reminderEmail')::boolean then
    select m.email into v_email from public.organization_members m
    where m.organization_id = o.id and m.user_id = p.id and m.status = 'active';
    if v_email is not null then
      insert into public.org_deliveries (organization_id, notification_id, user_id, channel,
        destination, subject, body)
      values (o.id, new.id, p.id, 'email', v_email, o.short_name || ' – ' || new.title, new.body);
    end if;
  end if;
  return null;
end;
$$;

create trigger notifications_org_deliveries
  after insert on public.notifications
  for each row when (new.app = 'org' and new.type = 'reminder')
  execute function private.org_queue_deliveries();

-- Envoi de la file : la fonction org-notify-send prend un lot (chaque envoi n'est pris
-- qu'une fois), puis note le résultat. Réservé au serveur.
create or replace function public.svc_org_deliveries_claim(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  with picked as (
    select d.id from public.org_deliveries d
    where d.status = 'queued'
    order by d.created_at
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    for update skip locked
  ), marked as (
    update public.org_deliveries d
    set attempts = d.attempts + 1, status = 'sending', error = null, sent_at = now()
    from picked where d.id = picked.id
    returning d.*
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'channel', m.channel,
    'destination', m.destination, 'subject', m.subject, 'body', m.body,
    'userId', m.user_id, 'attempts', m.attempts, 'shortName', o.short_name,
    'organizationName', o.name)), '[]'::jsonb) into result
  from marked m join public.organizations o on o.id = m.organization_id;
  return result;
end;
$$;

-- Résultat d'un envoi ; un échec est retenté jusqu'à 3 fois.
create or replace function public.svc_org_delivery_done(p_id uuid, p_ok boolean, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.org_deliveries
  set status = case when p_ok then 'sent'
                    when attempts < 3 and p_error is distinct from 'not_configured' then 'queued'
                    else 'failed' end,
      error = case when p_ok then null
                   when p_error = 'not_configured' then 'Canal non configuré sur le serveur'
                   else left(p_error, 300) end,
      sent_at = case when p_ok then now() else null end
  where id = p_id and status = 'sending'
$$;

revoke all on function public.svc_org_deliveries_claim(integer),
  public.svc_org_delivery_done(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.svc_org_deliveries_claim(integer),
  public.svc_org_delivery_done(uuid, boolean, text) to service_role;

-- Toutes les 5 minutes, s'il y a des envois en attente, la base appelle org-notify-send
-- (adresse et secret partagé dans le coffre : org_notify_url, org_notify_secret).
create or replace function private.org_deliveries_kick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  url text;
  secret text;
begin
  -- Envoi interrompu depuis plus de 15 minutes : remis dans la file.
  update public.org_deliveries set status = 'queued'
  where status = 'sending' and sent_at < now() - interval '15 minutes';
  if not exists (select 1 from public.org_deliveries where status = 'queued') then
    return;
  end if;
  select decrypted_secret into url from vault.decrypted_secrets where name = 'org_notify_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'org_notify_secret';
  if url is null or secret is null then
    return;
  end if;
  perform net.http_post(
    url := url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', secret));
end;
$$;

select cron.schedule('afp-envois-notifications', '*/5 * * * *', 'select private.org_deliveries_kick()');

-- Le membre renseigne son adresse électronique (facultative).
create or replace function public.my_org_email_set(p_slug text, p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.organizations := private.require_org_by_slug(p_slug);
  uid uuid := private.require_uid();
  v text := nullif(lower(btrim(coalesce(p_email, ''))), '');
begin
  if v is not null and (char_length(v) > 120 or v !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'Adresse électronique invalide.' using errcode = '22023';
  end if;
  update public.organization_members set email = v
  where organization_id = o.id and user_id = uid;
  if not found then
    raise exception 'Vous n’êtes pas membre de cette organisation.' using errcode = '42501',
      hint = 'access_denied:organization';
  end if;
end;
$$;

create or replace function public.my_org_email(p_slug text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.email from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  where o.slug = lower(btrim(p_slug)) and m.user_id = (select auth.uid())
$$;

-- Historique des envois et état de livraison (rôles qui voient les finances).
create or replace function public.org_deliveries_page(p_slug text, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.organizations := private.require_org_by_slug(p_slug);
begin
  perform private.require_sees_finance(o.id);
  return jsonb_build_object(
    'summary', (
      select jsonb_build_object(
        'sent', count(*) filter (where status = 'sent'),
        'failed', count(*) filter (where status = 'failed'),
        'queued', count(*) filter (where status = 'queued'))
      from public.org_deliveries where organization_id = o.id
        and created_at > now() - interval '30 days'),
    'rows', coalesce((
      select jsonb_agg(x order by x ->> 'createdAt' desc) from (
        select jsonb_build_object('id', d.id, 'channel', d.channel,
          'to', private.full_name(d.user_id),
          -- Destination masquée : 77 ••• 45 67, a•••@domaine.sn
          'destination', case when d.channel = 'sms'
            then left(d.destination, 2) || ' ••• ' || right(d.destination, 4)
            else left(d.destination, 1) || '•••@' || split_part(d.destination, '@', 2) end,
          'subject', d.subject, 'status', d.status, 'error', d.error,
          'attempts', d.attempts, 'createdAt', d.created_at, 'sentAt', d.sent_at) x
        from public.org_deliveries d where d.organization_id = o.id
        order by d.created_at desc
        offset greatest(coalesce(p_offset, 0), 0) limit 50) t), '[]'::jsonb),
    'pageSize', 50);
end;
$$;

revoke all on function public.my_org_email_set(text, text), public.my_org_email(text),
  public.org_deliveries_page(text, integer) from public, anon;
grant execute on function public.my_org_email_set(text, text), public.my_org_email(text),
  public.org_deliveries_page(text, integer) to authenticated;

-- Conservation : les envois de plus de 12 mois sont effacés avec les notifications.
create or replace function private.org_purge_deliveries()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.org_deliveries where created_at < now() - interval '12 months'
$$;
select cron.schedule('afp-purge-envois', '20 3 * * *', 'select private.org_purge_deliveries()');

-- Réglages : rappels par SMS et par courriel (désactivés par défaut).
create or replace function private.org_settings(p_org uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    -- Rappels de cotisation : J-5, J-2, jour J, J+3, J+7, J+15 (cahier § 9.2).
    'reminderOffsets', '[-5, -2, 0, 3, 7, 15]'::jsonb,
    -- Au-delà de ce montant, seule l'administration générale approuve une dépense.
    'expenseCeiling', 500000,
    -- Le service financier vérifie la disponibilité avant la décision.
    'expenseNeedsVerification', true,
    'financingMaxAmount', 2000000,
    'financingMaxMonths', 24,
    'receiptFooter', 'Merci pour votre engagement au service de l’AFP.',
    'membershipNote', '',
    -- Rappels aussi par SMS (Orange, payant) et par courriel (SMTP) : désactivés par défaut.
    'reminderSms', false,
    'reminderEmail', false
  ) || coalesce((select o.settings from public.organizations o where o.id = p_org), '{}'::jsonb)
$function$
;

create or replace function public.organization_settings_update(p_slug text, p_settings jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  o public.organizations := private.require_org_by_slug(p_slug);
  uid uuid := private.require_uid();
  k text;
  v jsonb;
  clean jsonb := '{}'::jsonb;
  offsets int[];
  txt text;
begin
  if not private.is_org_admin(o.id) then
    raise exception 'Seule l’administration générale règle les paramètres.'
      using errcode = '42501', hint = 'access_denied:organization';
  end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    raise exception 'Paramètres invalides.' using errcode = '22023';
  end if;

  for k, v in select * from jsonb_each(p_settings) loop
    case k
      when 'reminderOffsets' then
        if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 8 then
          raise exception 'Rappels : 8 délais au plus.' using errcode = '22023';
        end if;
        select coalesce(array_agg(distinct x::int order by x::int), '{}') into offsets
        from jsonb_array_elements_text(v) x;
        if exists (select 1 from unnest(offsets) d where d not between -30 and 60) then
          raise exception 'Rappels : chaque délai doit être entre 30 jours avant et 60 jours après l’échéance.'
            using errcode = '22023';
        end if;
        clean := clean || jsonb_build_object(k, to_jsonb(offsets));
      when 'expenseCeiling', 'financingMaxAmount' then
        if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not between 0 and 1000000000
           or (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric) then
          raise exception 'Montant invalide pour « % ».', k using errcode = '22023';
        end if;
        clean := clean || jsonb_build_object(k, (v #>> '{}')::bigint);
      when 'financingMaxMonths' then
        if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not between 1 and 120 then
          raise exception 'Durée maximale : entre 1 et 120 mois.' using errcode = '22023';
        end if;
        clean := clean || jsonb_build_object(k, (v #>> '{}')::numeric::int);
      when 'expenseNeedsVerification' then
        if jsonb_typeof(v) <> 'boolean' then
          raise exception 'Valeur invalide pour la vérification des dépenses.' using errcode = '22023';
        end if;
        clean := clean || jsonb_build_object(k, v);
      when 'receiptFooter', 'membershipNote' then
        txt := nullif(btrim(coalesce(v #>> '{}', '')), '');
        perform private.inspect_input(k, txt);
        if char_length(coalesce(txt, '')) > 300 then
          raise exception 'Texte trop long (300 caractères au plus).' using errcode = '22023';
        end if;
        clean := clean || jsonb_build_object(k, coalesce(txt, ''));
      when 'reminderSms', 'reminderEmail' then
        if jsonb_typeof(v) <> 'boolean' then
          raise exception 'Valeur invalide pour « % ».', k using errcode = '22023';
        end if;
        clean := clean || jsonb_build_object(k, v);
      when 'permissions' then
        clean := clean || jsonb_build_object(k, private.org_permissions_clean(v));
      else
        raise exception 'Paramètre inconnu : %.', k using errcode = '22023';
    end case;
  end loop;

  update public.organizations set settings = settings || clean where id = o.id;
  perform private.audit(uid, 'org_settings_updated',
    format('a modifié les paramètres de « %s » (%s)', o.name,
      (select string_agg(x, ', ' order by x) from jsonb_object_keys(clean) x)));
  return private.org_settings(o.id);
end;
$function$
;

revoke execute on all functions in schema private from public;
