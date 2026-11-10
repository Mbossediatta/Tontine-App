-- Une personne peut être membre d'une tontine Calebasse ET militante d'une organisation
-- (AFP) : même compte, deux applis. Ses notifications et ses alertes push ne doivent pas
-- se mélanger.
--
-- - notifications.app : « calebasse » (tontines) ou « org » (organisations). Une
--   notification d'organisation se reconnaît à son type « organization » ou à son lien
--   vers l'espace d'une organisation (/espace/<adresse>…, ex. rappels de cotisation).
-- - push_subscriptions.app : l'appli installée sur le téléphone. Une alerte ne part que
--   vers les téléphones où l'appli concernée est installée.

alter table public.notifications
  add column app text not null default 'calebasse' check (app in ('calebasse', 'org'));

alter table public.push_subscriptions
  add column app text not null default 'calebasse' check (app in ('calebasse', 'org'));

create index notifications_user_app_idx on public.notifications (user_id, app, created_at desc);

grant insert (app) on public.push_subscriptions to authenticated;

create or replace function private.notification_app()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.type = 'organization' or new.link like '/espace/%' then
    new.app := 'org';
  end if;
  return new;
end;
$$;

create trigger notifications_app
  before insert on public.notifications
  for each row execute function private.notification_app();

update public.notifications
set app = 'org'
where type = 'organization' or link like '/espace/%';

-- Alerte push : seulement si l'appli concernée est installée sur un téléphone.
create or replace function private.push_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  url text;
  secret text;
begin
  if not exists (
    select 1 from public.push_subscriptions where user_id = new.user_id and app = new.app
  ) then
    return null;
  end if;
  select decrypted_secret into url from vault.decrypted_secrets where name = 'push_send_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'push_send_secret';
  if url is null or secret is null then
    return null;
  end if;
  perform net.http_post(
    url := url,
    body := jsonb_build_object('notificationId', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', secret)
  );
  return null;
end;
$$;
