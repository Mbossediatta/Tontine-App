-- Rappels automatiques et nettoyage (tâches pg_cron, heure de Dakar = UTC).
-- 1. Chaque matin à 9 h, la veille et le jour de la date limite : rappel à chaque membre qui
--    n'a pas tout payé, écrit avec le modèle « Rappel » dans sa langue (notification + push,
--    selon ses préférences). Une relance au plus par jour et par tour, manuelle ou automatique.
-- 2. Chaque nuit : suppression des codes SMS de plus d'un jour.

create or replace function private.send_due_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Africa/Dakar')::date;
  sent integer;
begin
  with due as (
    select r.id as round_id, r.due_date, g.id as group_id, g.name, g.payment_due_time, u.user_id
    from public.rounds r
    join public.groups g on g.id = r.group_id
    join (select distinct group_id, user_id from public.memberships where status = 'active') u
      on u.group_id = g.id
    where r.status = 'open' and g.status = 'active'
      and r.due_date in (today, today + 1)
      and private.round_paid(r.id, u.user_id) < private.round_total(r.id, u.user_id)
  ),
  recorded as (
    insert into public.payment_reminders (round_id, user_id, sent_by, day)
    select round_id, user_id, null, today from due
    on conflict (round_id, user_id, day) do nothing
    returning round_id, user_id
  ),
  notified as (
    insert into public.notifications (user_id, type, title, body, link)
    select d.user_id, 'reminder', 'Rappel de cotisation',
      private.render_template('reminder', p.language::text, jsonb_build_object(
        'prenom', p.first_name,
        'montant', private.format_amount(private.amount_due(d.round_id, d.user_id)::integer),
        'groupe', d.name,
        'date', to_char(d.due_date, 'DD/MM/YYYY')
          || case when d.payment_due_time <> time '23:59'
               then ' à ' || to_char(d.payment_due_time, 'HH24"h"MI') else '' end)),
      '/groupes/' || d.group_id
    from due d
    join recorded x on x.round_id = d.round_id and x.user_id = d.user_id
    join public.profiles p on p.id = d.user_id and p.deleted_at is null
    returning 1
  )
  select count(*) into sent from notified;
  return sent;
end;
$$;

create or replace function private.purge_old_otps()
returns integer
language sql
security definer
set search_path = ''
as $$
  with purged as (
    delete from private.auth_otps where created_at < now() - interval '1 day' returning 1
  )
  select count(*)::integer from purged
$$;

select cron.schedule('calebasse-rappels', '0 9 * * *', 'select private.send_due_reminders()');
select cron.schedule('calebasse-purge-codes', '30 3 * * *', 'select private.purge_old_otps()');
