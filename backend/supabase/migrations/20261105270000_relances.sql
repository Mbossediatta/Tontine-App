-- Relance manuelle des cotisations (boutons « Relancer » de l'admin) : une notification
-- « Rappel de cotisation » écrite avec le modèle « Retard » dans la langue du membre ; elle
-- part en notification push sur son téléphone (…_notifications_push.sql). Pas de SMS.
-- Une relance au plus par membre, par tour et par jour (anti-harcèlement), notée au journal.

alter type public.audit_action add value if not exists 'reminder_sent';

create table if not exists public.payment_reminders (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  sent_by uuid references public.profiles (id) on delete set null,
  -- Jour de Dakar (UTC+0) : la limite est d'une relance par jour calendaire.
  day date not null default current_date,
  sent_at timestamptz not null default now(),
  unique (round_id, user_id, day)
);

-- Écrite seulement par reminder_send (security definer) : aucune politique d'accès.
alter table public.payment_reminders enable row level security;

-- Modèle de message (Paramètres → modèles) dans la langue voulue, le français à défaut,
-- avec ses champs {prenom}, {montant}, {groupe}, {date} remplis.
create or replace function private.render_template(p_key text, p_language text, p_values jsonb)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t text;
  field record;
begin
  select coalesce(s.templates -> p_language ->> p_key, s.templates -> 'fr' ->> p_key)
  into t from public.platform_settings s;
  for field in select * from jsonb_each_text(p_values) loop
    t := replace(t, '{' || field.key || '}', field.value);
  end loop;
  return t;
end;
$$;

-- Relance : vérifie les droits sur le groupe, retient les membres qui n'ont pas payé et pas
-- encore été relancés aujourd'hui, les prévient et trace l'action. Renvoie leur nombre.
-- `p_user` : un seul membre (bouton sur sa ligne) ; null : tous ceux qui n'ont pas payé.
create or replace function public.reminder_send(p_round uuid, p_user uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.rounds := private.require_round(p_round);
  g public.groups := private.require_group(r.group_id);
  uid uuid := private.require_manage(g);
  targets uuid[];
begin
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
    join public.profiles p on p.id = m.user_id and p.deleted_at is null
    where m.group_id = g.id and m.status = 'active'
      and (p_user is null or m.user_id = p_user)
      and private.member_status(r.id, m.user_id) <> 'paid'
  ),
  recorded as (
    insert into public.payment_reminders (round_id, user_id, sent_by)
    select r.id, c.user_id, uid from candidates c
    on conflict (round_id, user_id, day) do nothing
    returning user_id
  )
  select coalesce(array_agg(user_id), '{}') into targets from recorded;

  if cardinality(targets) = 0 then
    if exists (select 1 from public.memberships m
               where m.group_id = g.id and m.status = 'active'
                 and private.member_status(r.id, m.user_id) <> 'paid') then
      raise exception 'Les membres qui n’ont pas payé ont déjà été relancés aujourd’hui. Réessayez demain.'
        using errcode = '23505';
    end if;
    return 0;
  end if;

  insert into public.notifications (user_id, type, title, body, link)
  select p.id, 'reminder', 'Rappel de cotisation',
    private.render_template('late', p.language::text, jsonb_build_object(
      'prenom', p.first_name,
      'montant', private.format_amount(private.amount_due(r.id, p.id)::integer),
      'groupe', g.name,
      'date', to_char(r.due_date, 'DD/MM/YYYY'))),
    '/groupes/' || g.id
  from public.profiles p
  where p.id = any (targets);

  perform private.audit(
    uid, 'reminder_sent',
    case when cardinality(targets) = 1
      then format('a relancé %s pour le tour %s de « %s »',
        private.full_name(targets[1]), r.number, g.name)
      else format('a relancé %s membres pour le tour %s de « %s »',
        cardinality(targets), r.number, g.name)
    end,
    g.id);
  return cardinality(targets);
end;
$$;

revoke all on function public.reminder_send(uuid, uuid) from public, anon;
grant execute on function public.reminder_send(uuid, uuid) to authenticated;
