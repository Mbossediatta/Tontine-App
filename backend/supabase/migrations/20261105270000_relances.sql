-- Relance manuelle des cotisations (boutons « Relancer » de l'admin) : SMS « Retard » dans la
-- langue du membre, envoyé par l'Edge Function reminders-send. Une relance au plus par
-- membre, par tour et par jour (anti-harcèlement) ; chaque relance est notée au journal.

alter type public.audit_action add value if not exists 'reminder_sent';

create table public.payment_reminders (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  sent_by uuid references public.profiles (id) on delete set null,
  -- Jour de Dakar (UTC+0) : la limite est d'une relance par jour calendaire.
  day date not null default current_date,
  sent_at timestamptz not null default now(),
  unique (round_id, user_id, day)
);

-- Écrite seulement par svc_reminder_prepare (rôle service) : aucune politique d'accès.
alter table public.payment_reminders enable row level security;

-- Prépare la relance : vérifie les droits de `p_actor` sur le groupe, retient les membres
-- qui n'ont pas payé et pas encore été relancés aujourd'hui, les note, les prévient dans
-- l'application et trace l'action. Renvoie de quoi écrire chaque SMS.
-- `p_user` : un seul membre (bouton sur sa ligne) ; null : tous ceux qui n'ont pas payé.
create or replace function public.svc_reminder_prepare(p_actor uuid, p_round uuid, p_user uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.rounds;
  g public.groups;
  due_label text;
  targets jsonb;
  sent_count integer;
begin
  -- Les règles d'accès (can_manage_group) lisent l'utilisateur de la requête : c'est l'admin.
  perform set_config('request.jwt.claims', json_build_object('sub', p_actor)::text, true);

  select * into r from public.rounds where id = p_round;
  if not found then
    raise exception 'Ce tour est introuvable.' using errcode = 'P0002';
  end if;
  g := private.require_group(r.group_id);
  perform private.require_manage(g);
  if r.status = 'upcoming' or r.cycle <> g.current_cycle then
    raise exception 'Ce tour n’est pas en cours : rien à relancer.' using errcode = '22023';
  end if;

  if p_user is not null then
    if not exists (select 1 from public.memberships m
                   where m.group_id = g.id and m.user_id = p_user and m.status = 'active') then
      raise exception 'Ce membre ne fait pas partie de ce groupe.' using errcode = '42501';
    end if;
    if private.member_status(r.id, p_user) = 'paid' then
      raise exception 'Ce membre a déjà payé.' using errcode = '22023';
    end if;
    if exists (select 1 from public.payment_reminders pr
               where pr.round_id = r.id and pr.user_id = p_user and pr.day = current_date) then
      raise exception 'Ce membre a déjà été relancé aujourd’hui. Réessayez demain.'
        using errcode = '23505';
    end if;
  end if;

  with candidates as (
    select distinct m.user_id
    from public.memberships m
    where m.group_id = g.id and m.status = 'active'
      and (p_user is null or m.user_id = p_user)
      and private.member_status(r.id, m.user_id) <> 'paid'
  ),
  recorded as (
    insert into public.payment_reminders (round_id, user_id, sent_by)
    select r.id, c.user_id, p_actor from candidates c
    on conflict (round_id, user_id, day) do nothing
    returning user_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'userId', p.id,
    'phone', p.phone,
    'firstName', p.first_name,
    'language', p.language,
    'amount', private.amount_due(r.id, p.id),
    -- Le membre a coupé les rappels : notification dans l'appli, pas de SMS.
    'sms', coalesce((p.notification_prefs ->> 'reminders')::boolean, true)
  )), '[]'::jsonb)
  into targets
  from recorded x
  join public.profiles p on p.id = x.user_id
  where p.deleted_at is null and p.phone is not null;

  sent_count := jsonb_array_length(targets);
  if sent_count = 0 then
    if exists (select 1 from public.memberships m
               where m.group_id = g.id and m.status = 'active'
                 and private.member_status(r.id, m.user_id) <> 'paid') then
      raise exception 'Les membres qui n’ont pas payé ont déjà été relancés aujourd’hui. Réessayez demain.'
        using errcode = '23505';
    end if;
    return jsonb_build_object('targets', targets, 'groupName', g.name, 'dueDate', r.due_date);
  end if;

  due_label := to_char(r.due_date, 'DD/MM/YYYY');
  insert into public.notifications (user_id, type, title, body, link)
  select (t ->> 'userId')::uuid, 'reminder', 'Rappel de cotisation',
    format('%s : merci de payer votre cotisation du tour %s (à régler avant le %s).',
      g.name, r.number, due_label),
    '/groupes/' || g.id
  from jsonb_array_elements(targets) t;

  perform private.audit(
    p_actor, 'reminder_sent',
    case when sent_count = 1
      then format('a relancé %s pour le tour %s de « %s »',
        private.full_name((targets -> 0 ->> 'userId')::uuid), r.number, g.name)
      else format('a relancé %s membres pour le tour %s de « %s »', sent_count, r.number, g.name)
    end,
    g.id);

  return jsonb_build_object('targets', targets, 'groupName', g.name, 'dueDate', r.due_date);
end;
$$;

revoke all on function public.svc_reminder_prepare(uuid, uuid, uuid) from public;
grant execute on function public.svc_reminder_prepare(uuid, uuid, uuid) to service_role;

-- Modèle de SMS dans la langue voulue (le français si la langue n'a pas ce modèle).
create or replace function public.svc_sms_template(p_key text, p_language text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(s.templates -> p_language ->> p_key, s.templates -> 'fr' ->> p_key)
  from public.platform_settings s
$$;

revoke all on function public.svc_sms_template(text, text) from public;
grant execute on function public.svc_sms_template(text, text) to service_role;
