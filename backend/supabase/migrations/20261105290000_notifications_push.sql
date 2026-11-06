-- Notifications push sur le téléphone (comme une messagerie) : chaque notification créée
-- dans l'application part aussi vers les téléphones abonnés du membre, via l'Edge Function
-- push-send (Web Push). Appel asynchrone par pg_net : la requête part après la validation de
-- la transaction, et une notification annulée ne part jamais.
--
-- Réglage, une fois par environnement (voir backend/README.md) : dans le coffre-fort Vault,
-- `push_send_url` (adresse de push-send) et `push_send_secret` (même valeur que PUSH_SECRET
-- dans les secrets des Edge Functions). Sans eux, rien ne part et rien n'échoue.

create extension if not exists pg_net with schema extensions;

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
  -- Aucun téléphone abonné : rien à envoyer.
  if not exists (select 1 from public.push_subscriptions where user_id = new.user_id) then
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

create trigger notifications_push
  after insert on public.notifications
  for each row execute function private.push_notification();
