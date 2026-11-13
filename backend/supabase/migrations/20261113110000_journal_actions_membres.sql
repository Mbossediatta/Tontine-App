-- Journal d'audit : les actions des membres aussi, pas seulement celles des admins.
--
-- Jusqu'ici, le journal ne gardait que les connexions et les gestes des administrateurs.
-- On y ajoute ce que font les membres eux-mêmes :
-- - création de leur compte et changement de PIN (Edge Functions) ;
-- - connexion de tout compte (Edge Function, plus seulement les admins) ;
-- - demande pour rejoindre un groupe ou une structure (quand c'est le membre qui la fait,
--   pas un admin qui l'ajoute : ce geste-là est déjà tracé) ;
-- - paiement en ligne réussi (tontine ou organisation ; les paiements de test exclus) ;
-- - demande d'échange de tour.
-- Déclencheurs sur les tables : rien ne change dans les fonctions existantes.

alter type public.audit_action add value if not exists 'signed_up';
alter type public.audit_action add value if not exists 'pin_changed';
alter type public.audit_action add value if not exists 'join_requested';
alter type public.audit_action add value if not exists 'online_payment';
alter type public.audit_action add value if not exists 'swap_requested';

create or replace function private.method_label(p_method text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_method
    when 'wave' then 'Wave'
    when 'orange_money' then 'Orange Money'
    when 'free_money' then 'Free Money'
    when 'cash' then 'espèces'
    else p_method
  end
$$;

-- Demande pour rejoindre un groupe de tontine.
create or replace function private.audit_membership_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is distinct from new.user_id then
    return new;
  end if;
  perform private.audit(new.user_id, 'join_requested',
    format(case when new.status = 'active' then 'a rejoint le groupe « %s »'
                else 'a demandé à rejoindre le groupe « %s »' end,
      (select g.name from public.groups g where g.id = new.group_id)),
    new.group_id);
  return new;
end;
$$;

create trigger memberships_audit_insert
  after insert on public.memberships
  for each row execute function private.audit_membership_insert();

-- Demande pour rejoindre une structure d'organisation.
create or replace function private.audit_structure_member_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is distinct from new.user_id then
    return new;
  end if;
  perform private.audit(new.user_id, 'join_requested',
    (select format('a demandé à rejoindre « %s » (%s)', s.name, o.short_name)
     from public.org_structures s join public.organizations o on o.id = s.organization_id
     where s.id = new.structure_id));
  return new;
end;
$$;

create trigger structure_members_audit_insert
  after insert on public.structure_members
  for each row execute function private.audit_structure_member_insert();

-- Paiement en ligne réussi (tontine).
create or replace function private.audit_payment_paid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group uuid;
begin
  if new.status <> 'paid' or old.status = 'paid' or new.method = 'cash' then
    return new;
  end if;
  select r.group_id into v_group from public.rounds r where r.id = new.round_id;
  perform private.audit(new.user_id, 'online_payment',
    format('a payé %s en ligne (%s) dans « %s »', private.format_amount(new.amount),
      private.method_label(new.method::text),
      (select g.name from public.groups g where g.id = v_group)),
    v_group);
  return new;
end;
$$;

create trigger payments_audit_paid
  after update of status on public.payments
  for each row execute function private.audit_payment_paid();

-- Paiement en ligne réussi (organisation), hors mode test.
create or replace function private.audit_org_intent_paid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'paid' or old.status = 'paid' or new.test_mode then
    return new;
  end if;
  perform private.audit(new.user_id, 'online_payment',
    format('a payé %s en ligne (%s) à %s', private.format_amount(new.amount),
      private.method_label(new.method::text),
      (select o.short_name from public.organizations o where o.id = new.organization_id)));
  return new;
end;
$$;

create trigger org_payment_intents_audit_paid
  after update of status on public.org_payment_intents
  for each row execute function private.audit_org_intent_paid();

-- Demande d'échange de tour.
create or replace function private.audit_swap_request_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.audit(new.requester_id, 'swap_requested',
    format('a demandé un échange de tour avec %s dans « %s »', private.full_name(new.partner_id),
      (select g.name from public.groups g where g.id = new.group_id)),
    new.group_id);
  return new;
end;
$$;

create trigger swap_requests_audit_insert
  after insert on public.swap_requests
  for each row execute function private.audit_swap_request_insert();

-- Gestes du militant sur sa propre fiche d'organisation : carte remplacée, politique de
-- confidentialité acceptée, courriel enregistré. (Les gestes des admins de l'organisation
-- sur les militants sont déjà tracés par leurs fonctions.)
create or replace function private.audit_org_member_self_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org text;
begin
  if auth.uid() is distinct from new.user_id then
    return new;
  end if;
  select o.short_name into v_org from public.organizations o where o.id = new.organization_id;
  if new.card_token is distinct from old.card_token then
    perform private.audit(new.user_id, 'member_updated',
      format('a remplacé sa carte de membre (%s)', v_org));
  end if;
  if new.privacy_accepted_at is distinct from old.privacy_accepted_at then
    perform private.audit(new.user_id, 'member_updated',
      format('a accepté la politique de confidentialité (%s)', v_org));
  end if;
  if new.email is distinct from old.email then
    perform private.audit(new.user_id, 'member_updated',
      format('a changé son adresse électronique (%s)', v_org));
  end if;
  return new;
end;
$$;

create trigger organization_members_audit_self_update
  after update of card_token, privacy_accepted_at, email on public.organization_members
  for each row execute function private.audit_org_member_self_update();

revoke all on function private.audit_org_member_self_update() from public;

revoke all on function private.method_label(text), private.audit_membership_insert(),
  private.audit_structure_member_insert(), private.audit_payment_paid(),
  private.audit_org_intent_paid(), private.audit_swap_request_insert() from public;
