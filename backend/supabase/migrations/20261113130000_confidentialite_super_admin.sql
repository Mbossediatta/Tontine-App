-- Politique de confidentialité : le super administrateur de la plateforme Calebasse peut
-- désormais consulter le fichier des membres et le journal des opérations (décision du
-- 2026-11-13). Le texte par défaut le dit au point 4, et les organisations qui utilisent ce
-- texte passent à une nouvelle version : chaque membre l'accepte à nouveau à sa prochaine
-- connexion. Une organisation qui a écrit son propre texte doit l'adapter elle-même.

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
La plateforme Calebasse de l'Espoir héberge l'application pour le compte de l'organisation, qui en reste responsable. Elle n'utilise pas vos données à des fins commerciales ni pour son propre compte.

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
Seules les personnes habilitées, selon leur rôle : l'administration générale et financière de l'organisation, le contrôleur financier, et les responsables des structures dont vous êtes membre (pour leur structure seulement). L'exploitant de la plateforme Calebasse de l'Espoir (super administrateur) peut aussi consulter le fichier des membres et le journal des opérations, en lecture seule, pour le support technique, la sécurité et le contrôle du bon fonctionnement du service. Les prestataires techniques n'y accèdent que pour faire fonctionner le service : hébergement (Supabase, serveurs situés dans l'Union européenne), envoi des SMS (Orange), paiement en ligne (PayTech, Wave, Orange Money).

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

update public.organizations
set privacy_version = privacy_version + 1, privacy_updated_at = now()
where privacy_text is null;
