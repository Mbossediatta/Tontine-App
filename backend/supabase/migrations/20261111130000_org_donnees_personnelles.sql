-- Protection des données personnelles des organisations (cahier AFP § 15.5, loi sénégalaise
-- n° 2008-12 et Commission de Protection des Données Personnelles, CDP). Demande du
-- 2026-11-11 :
-- 1. Politique de confidentialité PROPRE à chaque organisation (l'AFP est responsable du
--    traitement de son fichier, pas Calebasse) : texte modifiable par l'administration
--    générale, versionné ; chaque membre l'accepte, et l'accepte à nouveau à chaque version.
-- 2. Droit d'accès (loi 2008-12, art. 62) : chaque membre télécharge toutes les données que
--    l'organisation détient sur lui.
-- 3. Durées de conservation, appliquées chaque nuit (private.org_apply_retention) :
--    · demande d'adhésion refusée : effacée 6 mois après le refus ;
--    · adhésion jamais validée : effacée 12 mois après la demande ;
--    · membre sorti : localisation effacée 5 ans après la sortie (le numéro de
--      membre et les paiements restent : obligations comptables, 10 ans) ;
--    · paiements en ligne échoués ou de test : effacés après 12 mois ;
--    · notifications de l'organisation : effacées après 12 mois.
--    Le journal des opérations et les écritures financières ne sont jamais effacés.

-- ---------------------------------------------------------------------------
-- 1. Politique de confidentialité
-- ---------------------------------------------------------------------------

alter table public.organizations
  add column privacy_text text check (char_length(privacy_text) <= 20000),
  add column privacy_version integer not null default 1 check (privacy_version >= 1),
  add column privacy_updated_at timestamptz not null default now();

alter table public.organization_members
  add column privacy_version_accepted integer,
  add column privacy_accepted_at timestamptz;

alter type public.audit_action add value if not exists 'org_privacy_updated';

-- Texte par défaut, au nom de l'organisation ; les mentions entre crochets sont à compléter
-- par l'organisation avant la mise en production (adresse, référent, récépissé de la CDP).
create or replace function private.org_privacy_default(p_org uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select format($t$POLITIQUE DE CONFIDENTIALITÉ – %1$s (%2$s)

1. Responsable du traitement
Le fichier des membres est tenu par l'organisation %1$s (%2$s), [adresse du siège], responsable du traitement au sens de la loi n° 2008-12 du 25 janvier 2008 sur la protection des données à caractère personnel. Contact pour toute question sur vos données : [nom du référent données personnelles], [téléphone], [adresse électronique].
La plateforme Calebasse de l'Espoir héberge l'application pour le compte de l'organisation, qui en reste responsable. Elle n'utilise pas vos données pour son propre compte.

2. Données collectées
· Identité : prénom, nom, photo (facultative) ;
· Contact : numéro de téléphone ;
· Localisation : région, département, commune, localité ;
· Vie de membre : numéro de membre, date d'adhésion, statut, structures d'appartenance et responsabilités ;
· Cotisations et contributions : échéances, paiements, moyens de paiement, reçus ;
· Demandes de financement que vous déposez et leur suivi ;
· Données techniques de sécurité : connexions, tentatives refusées.
Votre appartenance à l'organisation est une donnée sensible (opinion politique) : elle n'est traitée qu'avec votre consentement et pour les finalités ci-dessous.

3. Finalités
· Tenir le fichier des membres et délivrer la carte de membre ;
· Gérer les cotisations, les reçus et les caisses des structures ;
· Vous informer (rappels de cotisation, notifications de votre structure) ;
· Instruire les demandes de financement ;
· Assurer la sécurité et la traçabilité des opérations financières.
Vos données ne sont ni vendues, ni louées, ni utilisées à des fins commerciales.

4. Qui peut voir vos données
Seules les personnes habilitées, selon leur rôle : l'administration générale et financière de l'organisation, le contrôleur financier, et les responsables des structures dont vous êtes membre (pour leur structure seulement). Les prestataires techniques n'y accèdent que pour faire fonctionner le service : hébergement (Supabase, serveurs situés dans l'Union européenne), envoi des SMS (Orange), paiement en ligne (PayTech, Wave, Orange Money).

5. Transfert hors du Sénégal
Les données sont hébergées dans l'Union européenne (Francfort, Allemagne), pays assurant un niveau de protection reconnu. Ce transfert fait l'objet des formalités prévues auprès de la CDP.

6. Durées de conservation
· Membre actif : pendant toute la durée de l'adhésion ;
· Membre sorti : localisation effacée 5 ans après la sortie ; les paiements et le numéro de membre sont conservés 10 ans (obligations comptables) ;
· Demande d'adhésion refusée : effacée 6 mois après le refus ; jamais validée : 12 mois après la demande ;
· Notifications : 12 mois ; paiements en ligne échoués ou de test : 12 mois ;
· Journal des opérations financières : conservé, il ne peut être ni modifié ni supprimé.

7. Vos droits
Vous pouvez à tout moment : accéder à vos données (bouton « Télécharger mes données » de votre profil), les faire rectifier (demande de modification depuis votre profil), vous opposer à leur traitement ou demander leur suppression en quittant l'organisation (sous réserve des obligations comptables ci-dessus). Adressez votre demande au référent indiqué au point 1. Si vous estimez que vos droits ne sont pas respectés, vous pouvez saisir la Commission de Protection des Données Personnelles (CDP), Dakar – www.cdp.sn.

8. Sécurité
Connexion par code SMS et code PIN, échanges chiffrés (HTTPS), accès limités par rôle, journal des opérations, sauvegardes.

9. Déclaration
Traitement déclaré à la CDP : [numéro de récépissé].

10. Modifications
Toute modification de cette politique vous est présentée à votre prochaine connexion et doit être acceptée pour continuer.$t$, o.name, o.short_name)
  from public.organizations o where o.id = p_org
$$;

-- Politique en vigueur (publique : elle se lit avant l'inscription).
create or replace function public.org_privacy(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.organizations;
begin
  select * into o from public.organizations where slug = lower(btrim(p_slug)) and not is_suspended;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'organizationName', o.name, 'shortName', o.short_name,
    'text', coalesce(o.privacy_text, private.org_privacy_default(o.id)),
    'isDefault', o.privacy_text is null,
    'version', o.privacy_version, 'updatedAt', o.privacy_updated_at);
end;
$$;

-- Nouvelle version (administration générale) : chaque membre devra l'accepter à nouveau.
create or replace function public.org_privacy_save(p_slug text, p_text text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.organizations := private.require_org_by_slug(p_slug);
  uid uuid := private.require_uid();
  txt text := nullif(btrim(coalesce(p_text, '')), '');
begin
  if not private.is_org_admin(o.id) then
    raise exception 'Seule l’administration générale modifie la politique de confidentialité.'
      using errcode = '42501', hint = 'access_denied:organization';
  end if;
  if txt is null or char_length(txt) < 200 then
    raise exception 'Le texte est trop court (200 caractères au moins).' using errcode = '22023';
  end if;
  if char_length(txt) > 20000 then
    raise exception 'Le texte est trop long (20 000 caractères au plus).' using errcode = '22023';
  end if;
  perform private.inspect_input('privacyText', txt);
  update public.organizations
  set privacy_text = txt, privacy_version = privacy_version + 1, privacy_updated_at = now()
  where id = o.id;
  perform private.audit(uid, 'org_privacy_updated',
    format('a publié une nouvelle politique de confidentialité pour « %s »', o.name));
  return public.org_privacy(o.slug);
end;
$$;

-- Le membre (ou le demandeur d'adhésion) accepte la version en vigueur.
create or replace function public.org_privacy_accept(p_slug text, p_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.organizations := private.require_org_by_slug(p_slug);
  uid uuid := private.require_uid();
begin
  if p_version is distinct from o.privacy_version then
    raise exception 'La politique de confidentialité a changé : relisez la nouvelle version.'
      using errcode = '22023';
  end if;
  update public.organization_members
  set privacy_version_accepted = o.privacy_version, privacy_accepted_at = now()
  where organization_id = o.id and user_id = uid;
  if not found then
    raise exception 'Vous n’êtes pas membre de cette organisation.' using errcode = '42501',
      hint = 'access_denied:organization';
  end if;
end;
$$;

-- Le compte connecté doit-il (encore) accepter la politique ?
create or replace function public.my_org_privacy_status(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.organizations := private.require_org_by_slug(p_slug);
  uid uuid := private.require_uid();
  m public.organization_members;
begin
  select * into m from public.organization_members
  where organization_id = o.id and user_id = uid;
  -- ready : l'organisation a publié son propre texte (le texte par défaut, avec ses
  -- mentions à compléter, n'est jamais imposé aux membres).
  return jsonb_build_object(
    'member', found,
    'ready', o.privacy_text is not null,
    'current', o.privacy_version,
    'accepted', m.privacy_version_accepted,
    'acceptedAt', m.privacy_accepted_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Droit d'accès : toutes les données du membre dans l'organisation
-- ---------------------------------------------------------------------------

create or replace function public.my_org_data(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.organizations := private.require_org_by_slug(p_slug);
  uid uuid := private.require_uid();
  m public.organization_members;
  p public.profiles;
begin
  select * into m from public.organization_members where organization_id = o.id and user_id = uid;
  if not found then
    raise exception 'Vous n’êtes pas membre de cette organisation.' using errcode = '42501',
      hint = 'access_denied:organization';
  end if;
  select * into p from public.profiles where id = uid;
  return jsonb_build_object(
    'generatedAt', now(),
    'organization', jsonb_build_object('name', o.name, 'shortName', o.short_name),
    'identity', jsonb_build_object('firstName', p.first_name, 'lastName', p.last_name,
      'phone', p.phone, 'hasPhoto', p.avatar_url is not null, 'language', p.language),
    'membership', jsonb_build_object('memberNumber', m.member_number, 'status', m.status,
      'joinedAt', m.joined_at, 'requestedAt', m.created_at,
      'region', m.region, 'departement', m.departement, 'commune', m.commune,
      'localite', m.localite,
      'privacyVersionAccepted', m.privacy_version_accepted,
      'privacyAcceptedAt', m.privacy_accepted_at),
    'structures', coalesce((
      select jsonb_agg(jsonb_build_object('structure', s.name, 'status', sm.status,
        'requestedAt', sm.requested_at, 'decidedAt', sm.decided_at, 'leftAt', sm.left_at)
        order by sm.requested_at)
      from public.structure_members sm join public.org_structures s on s.id = sm.structure_id
      where sm.user_id = uid and s.organization_id = o.id), '[]'::jsonb),
    'responsibilities', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object('scope', o.short_name, 'role', r.role, 'since', r.created_at) x
        from public.organization_roles r where r.organization_id = o.id and r.user_id = uid
        union all
        select jsonb_build_object('scope', s.name, 'role', sr.role, 'since', sr.created_at)
        from public.structure_roles sr join public.org_structures s on s.id = sr.structure_id
        where sr.user_id = uid and s.organization_id = o.id) t), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('date', pay.created_at, 'amount', pay.amount,
        'fund', f.name, 'structure', s.name, 'method', pay.method,
        'reference', pay.reference, 'receipt', pay.receipt_number,
        'cancelledAt', pay.cancelled_at) order by pay.created_at)
      from public.org_payments pay
      join public.org_funds f on f.id = pay.fund_id
      join public.org_structures s on s.id = f.structure_id
      where pay.user_id = uid and s.organization_id = o.id), '[]'::jsonb),
    'onlinePayments', coalesce((
      select jsonb_agg(jsonb_build_object('date', x.created_at, 'amount', x.amount,
        'serviceFee', x.service_fee, 'method', x.method, 'status', x.status,
        'payerPhone', x.payer_phone) order by x.created_at)
      from public.org_payment_intents x
      where x.user_id = uid and x.organization_id = o.id), '[]'::jsonb),
    'financings', coalesce((
      select jsonb_agg(jsonb_build_object('number', fi.number, 'title', fi.title,
        'nature', fi.nature, 'amountRequested', fi.amount_requested, 'status', fi.status,
        'amountGranted', fi.amount_granted, 'createdAt', fi.created_at) order by fi.created_at)
      from public.org_financings fi
      where fi.user_id = uid and fi.organization_id = o.id), '[]'::jsonb),
    'profileRequests', coalesce((
      select jsonb_agg(jsonb_build_object('date', pr.created_at, 'changes', pr.changes,
        'status', pr.status, 'decidedAt', pr.decided_at) order by pr.created_at)
      from public.org_profile_requests pr
      where pr.user_id = uid and pr.organization_id = o.id), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Durées de conservation (chaque nuit)
-- ---------------------------------------------------------------------------

-- Date de sortie : posée quand le statut passe à « sorti », retirée s'il revient. Les
-- sorties antérieures prennent la date de dernière modification de la fiche.
alter table public.organization_members add column left_at timestamptz;
update public.organization_members set left_at = updated_at where status = 'left';

create or replace function private.org_member_left_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'left' and old.status is distinct from 'left' then
    new.left_at := now();
  elsif new.status <> 'left' then
    new.left_at := null;
  end if;
  return new;
end;
$$;

create trigger organization_members_left_at
  before update of status on public.organization_members
  for each row execute function private.org_member_left_at();

create or replace function private.org_apply_retention()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_rejected integer;
  n_pending integer;
  n_left integer;
  n_intents integer;
  n_notifs integer;
begin
  -- Demandes d'adhésion à une structure refusées depuis plus de 6 mois.
  delete from public.structure_members
  where status = 'rejected' and coalesce(decided_at, requested_at) < now() - interval '6 months';
  get diagnostics n_rejected = row_count;

  -- Adhésions jamais validées depuis 12 mois (sans numéro, sans paiement) : la fiche
  -- d'organisation et les demandes en attente disparaissent.
  with stale as (
    select m.id, m.organization_id, m.user_id from public.organization_members m
    where m.status = 'pending' and m.member_number is null
      and m.created_at < now() - interval '12 months'
      and not exists (
        select 1 from public.org_payments pay
        join public.org_funds f on f.id = pay.fund_id
        join public.org_structures s on s.id = f.structure_id
        where pay.user_id = m.user_id and s.organization_id = m.organization_id)
  ), gone as (
    delete from public.structure_members sm
    using stale, public.org_structures s
    where sm.user_id = stale.user_id and sm.structure_id = s.id
      and s.organization_id = stale.organization_id and sm.status = 'pending'
    returning 1
  )
  delete from public.organization_members m using stale where m.id = stale.id;
  get diagnostics n_pending = row_count;

  -- Membres sortis depuis 5 ans : localisation effacée (le numéro de membre et les
  -- paiements restent pour les obligations comptables ; leur carte affiche déjà « non
  -- valide » sans identité).
  update public.organization_members
  set region = null, departement = null, commune = null, localite = null
  where status = 'left' and left_at < now() - interval '5 years'
    and (region is not null or departement is not null or commune is not null
      or localite is not null);
  get diagnostics n_left = row_count;

  -- Paiements en ligne échoués ou de test depuis 12 mois (jamais comptabilisés).
  delete from public.org_payment_intents
  where status in ('failed', 'test') and created_at < now() - interval '12 months';
  get diagnostics n_intents = row_count;

  -- Notifications des organisations de plus de 12 mois.
  delete from public.notifications
  where app = 'org' and created_at < now() - interval '12 months';
  get diagnostics n_notifs = row_count;

  return jsonb_build_object('rejectedRequests', n_rejected, 'stalePending', n_pending,
    'leftMembersCleared', n_left, 'onlineAttempts', n_intents, 'notifications', n_notifs);
end;
$$;

select cron.schedule('afp-conservation-donnees', '15 3 * * *', 'select private.org_apply_retention()');

-- ---------------------------------------------------------------------------
-- Droits
-- ---------------------------------------------------------------------------

revoke all on function public.org_privacy(text), public.org_privacy_save(text, text),
  public.org_privacy_accept(text, integer), public.my_org_privacy_status(text),
  public.my_org_data(text) from public, anon, authenticated;
grant execute on function public.org_privacy(text) to anon, authenticated;
grant execute on function public.org_privacy_save(text, text),
  public.org_privacy_accept(text, integer), public.my_org_privacy_status(text),
  public.my_org_data(text) to authenticated;
revoke execute on all functions in schema private from public;
