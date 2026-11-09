-- Garde-fou : le super admin ne décide pas sur son propre argent.
--
-- Un super admin peut être membre d'un groupe (décision du 9 novembre 2026). Il ne peut
-- alors ni valider sa propre cagnotte, ni en enregistrer l'envoi, ni enregistrer son propre
-- paiement en espèces ou le remboursement de sa propre dette : c'est l'administrateur du
-- groupe qui le fait. Il ne peut pas non plus ouvrir de réclamation : c'est lui qui les
-- traite, elle resterait sans personne pour la trancher ; il règle le problème
-- directement avec l'administrateur du groupe.
--
-- Contrôle posé sur les tables (déclencheurs) : il vaut quel que soit le chemin d'écriture.
-- Les traitements du serveur (envoi automatique, paiement en ligne, tâches planifiées)
-- tournent sans compte connecté : private.is_super_admin() y est faux, rien n'est bloqué.

create or replace function private.refuse_self_service(p_message text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%', p_message
    using errcode = '42501', hint = 'access_denied:son propre argent';
end;
$$;

-- Valider la cagnotte d'un tour dont on est bénéficiaire.
create or replace function private.guard_self_payout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'paid_out' and old.status is distinct from 'paid_out'
     and new.recipient_type = 'members'
     and private.is_super_admin()
     and exists (
       select 1
       from public.round_beneficiaries b
       join public.memberships m on m.id = b.membership_id
       where b.round_id = new.id and m.user_id = private.active_uid()
     ) then
    perform private.refuse_self_service(
      'Vous êtes bénéficiaire de ce tour : c’est l’administrateur du groupe qui valide ce versement.');
  end if;
  return new;
end;
$$;

create trigger rounds_guard_self_payout
  before update of status on public.rounds
  for each row execute function private.guard_self_payout();

-- Enregistrer l'envoi de sa propre cagnotte.
create or replace function private.guard_self_payout_sent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.sent_at is not null and old.sent_at is null
     and private.is_super_admin()
     and exists (
       select 1 from public.memberships m
       where m.id = new.membership_id and m.user_id = private.active_uid()
     ) then
    perform private.refuse_self_service(
      'Cette cagnotte est la vôtre : c’est l’administrateur du groupe qui en enregistre l’envoi.');
  end if;
  return new;
end;
$$;

create trigger round_beneficiaries_guard_self_sent
  before update of sent_at on public.round_beneficiaries
  for each row execute function private.guard_self_payout_sent();

-- Enregistrer soi-même son propre paiement (espèces, ou paiement constaté sur un litige).
create or replace function private.guard_self_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.recorded_by is not null
     and new.recorded_by = new.user_id
     and private.is_super_admin()
     and new.user_id = private.active_uid() then
    perform private.refuse_self_service(
      'C’est votre propre paiement : c’est l’administrateur du groupe qui l’enregistre.');
  end if;
  return new;
end;
$$;

create trigger payments_guard_self_payment
  before insert on public.payments
  for each row execute function private.guard_self_payment();

-- Enregistrer le remboursement en espèces de sa propre dette.
create or replace function private.guard_self_debt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'settled' and old.status is distinct from 'settled'
     and new.settled_via = 'cash'
     and private.is_super_admin()
     and new.user_id = private.active_uid() then
    perform private.refuse_self_service(
      'C’est votre propre dette : c’est l’administrateur du groupe qui enregistre son remboursement.');
  end if;
  return new;
end;
$$;

create trigger debts_guard_self_debt
  before update of status on public.debts
  for each row execute function private.guard_self_debt();

-- Ouvrir une réclamation : le super admin est celui qui les traite.
create or replace function private.guard_self_dispute()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.is_super_admin() and new.user_id = private.active_uid() then
    perform private.refuse_self_service(
      'Vous traitez les réclamations : réglez ce problème directement avec l’administrateur du groupe.');
  end if;
  return new;
end;
$$;

create trigger disputes_guard_self_dispute
  before insert on public.disputes
  for each row execute function private.guard_self_dispute();
