# Backend — Calebasse de l’Espoir

Backend Supabase de la PWA de tontine : base PostgreSQL (règles RLS), Edge Functions
(connexion par code SMS et PIN, paiements PayTech, SMS Orange, notifications), tâches
planifiées.

**Documents de référence** (à lire avant de coder) :
- [`../tontine-pwa/docs/CAHIER-DES-CHARGES-INTEGRATION.md`](../tontine-pwa/docs/CAHIER-DES-CHARGES-INTEGRATION.md)
  — ce que le frontend attend, décisions du 5 novembre 2026 (prioritaire) ;
- [`../tontine-pwa/docs/CONTRAT-BACKEND.md`](../tontine-pwa/docs/CONTRAT-BACKEND.md)
  — les 100 fonctions et les 137 règles ;
- `../Cahier des charges Backend – PWA Tontine.pdf` — cahier d’origine (stack, sécurité).

## Prérequis

- **Node.js** 20 ou plus (la CLI Supabase est une dépendance de ce dossier : `npx supabase`).
- **Docker Desktop**, démarré : la base locale tourne dans des conteneurs.

## Démarrer en local

```bash
cd backend
npm install                       # installe la CLI Supabase (version figée)
cp supabase/functions/.env.example supabase/functions/.env   # puis remplir les secrets
npm start                         # base locale + Studio (http://localhost:54323)
npm run reset                     # rejoue les migrations puis seed.sql
npm run functions                 # Edge Functions en local
npm run types                     # régénère ../tontine-pwa/src/types/database.ts
npm run test:db                   # tests pgTAP (règles d’accès)
npm run test:auth                 # parcours de connexion de bout en bout (fonctions lancées
                                  # avec SMS_MODE=console, sinon de vrais SMS partent)
npm stop
```

`npm start` affiche l’URL de l’API et la clé publique (`anon`) à reporter dans
`../tontine-pwa/.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) quand on passera le
frontend en `VITE_USE_MOCKS=false`.

## Organisation

```
backend/
  package.json            CLI Supabase et scripts
  supabase/
    config.toml           réglages (jetons de 15 min, pas d’inscription publique…)
    migrations/           schéma SQL versionné — jamais de modification à la main
    seed.sql              données de démonstration (mêmes que la simulation du frontend)
    functions/
      _shared/            code commun : erreurs, CORS, PayTech, SMS Orange, push
      .env.example        modèle des secrets (le vrai .env n’est jamais commité)
    tests/database/       tests pgTAP
```

## Schéma (étape 2)

Les migrations versionnées dans `supabase/migrations/` :

| Fichier | Contenu |
|---|---|
| `…130000_schema_comptes_groupes.sql` | `profiles`, `communities`, `community_admins`, `groups`, `memberships` (une ligne par part ; une demande d’adhésion = ligne `pending`) |
| `…130100_schema_tours_paiements.sql` | `rounds`, `round_beneficiaries`, `payments` (avec `service_fee_amount`), `penalties`, `platform_earnings`, `admin_compensations`, `swap_requests` |
| `…130200_schema_backoffice.sql` | `notifications`, `push_subscriptions`, `audit_log` et `security_events` (ajout seul), `disputes`, `dispute_events`, `provider_ledger`, `sms_log`, `platform_settings` (une ligne, modèles en `fr` et `wo`) ; schéma `private` : `auth_otps`, `auth_pins` |
| `…160000_admin_pin_status.sql` | RPC `admin_pin_pending`, qui expose uniquement le statut de création du PIN au super admin, jamais son empreinte |
| `…170000_admin_create.sql` | RPC transactionnelle appelée par `admin-create` pour promouvoir un membre existant ou enregistrer un nouvel administrateur |
| `…180000_communautes.sql` | RPC `community_save` (super admin) : nom, description, admins affectés, notification et audit |
| `…190000_groupes.sql` | Étape 5 : RPC des groupes (`group_create`, `group_update`, `group_remove`, `group_regenerate_invite`, `group_join_preview`, `group_request_join`, `group_request_join_open`, `groups_discoverable`, `group_announce`), des adhésions (`membership_accept`, `_reject`, `_remove`, `_set_role`, `_add_by_phone`), de la supervision (`group_suspend`, `_reactivate`, `_close`, `_archive`, `_change_admin`, `_transfer`), `admin_choices` et `log_refusal` ; journaux : seul le passage à vide d’une référence (suppression d’un groupe ou d’un compte) est permis |
| `…210000_membres_admins.sql` | RPC du super admin : `member_block`, `member_unblock`, `admin_update`, `admin_suspend`, `admin_reactivate`, `admin_revoke`, `admin_reassign_groups` ; pour les Edge Functions : `svc_member_create`, `svc_phone_change` |
| `…220000_cycle.sql` | Étape 6 : ordre (`order_draw`, `order_set`), démarrage et calendrier des tours (`group_start`, selon rythme et durée de tour), statuts calculés par le serveur (`group_round_statuses`), paiement en espèces (`payment_record_cash`), versement et tour suivant (`round_payout`, période réservée versée par le super admin), nouveau cycle (`group_restart_cycle`) |
| `…230000_paiement_en_ligne.sql` | Étape 9 : `svc_payment_prepare` (montant + frais PayTech payés en plus), `svc_payment_set_token`, `svc_payment_confirm` (montant exact, idempotent, revenus, tour prêt), `svc_payment_fail`, `payment_receipt` |
| `…240000_parametres.sql` | `settings_get`, `settings_update` (validations ; clé secrète PayTech dans le coffre-fort Vault, seul l’indice reste lisible), `svc_paytech_keys` (Edge Functions) |
| `…250000_finances_litiges_annonces.sql` | `payout_block`, `payout_unblock`, `admin_compensate`, litiges (`dispute_take`, `_record_payment`, `_refund`, `_reject`, ouverture automatique sur notification PayTech anormale), `svc_announcement` |
| `…260000_conditions.sql` | Conditions d’utilisation : version des textes (augmentée quand ils changent), `terms_acceptances` (preuve en ajout seul : qui, version, date, appareil), `legal_terms` (sans session), `terms_status`, `terms_accept`, `svc_terms_due` et `svc_terms_accept` (création du PIN) |
| `…270000_relances.sql` | Relance manuelle : `payment_reminders` (une relance par membre, par tour et par jour), `reminder_send` (droits, membres à relancer, notification écrite avec le modèle « Retard » dans la langue du membre, audit `reminder_sent`), `private.render_template` ; pas de SMS |
| `…280000_echanges.sql` | Échange de tour entre membres (exception voulue au verrouillage de l’ordre) : parts échangées sur `swap_requests`, `swap_request` (tours à venir, une demande en cours par part), `swap_respond` (accord du membre), `swap_decide` (admin : bénéficiaires et rangs échangés, audit `swap_approved`), `swap_cancel` |
| `…290000_notifications_push.sql` | Notifications push : chaque notification créée part vers les téléphones abonnés du membre (déclencheur `notifications_push` → `pg_net` → Edge Function `push-send`, Web Push, préférences du membre respectées) |
| `…300000_calendrier_confidentiel.sql` | Calendrier confidentiel : un membre ne lit que ses propres lignes de `round_beneficiaries` et plus le rang (`payout_order`) des autres ; `group_order_view` (son rang, tous pour un admin du groupe, nombre de bénéficiaires par tour) ; `swap_request` sur un tour anonyme (bénéficiaire retrouvé par le serveur), réponses sans nom pour le demandeur |
| `…310000_statuts_confidentiels.sql` | Statuts de paiement confidentiels : `group_round_statuses` ne donne à un membre que son propre statut (tous pour un admin du groupe) ; le nombre de parts payées reste visible |
| `…320000_versements.sql` | Paiement par versements : plusieurs paiements réussis par tour (un seul essai en cours), « payé » quand la somme atteint le total du tour (`round_total`, `round_paid`), « en retard » sinon à la date limite ; `private.installment` ; `svc_payment_prepare` et `payment_record_cash` acceptent `p_periods` (jours ou périodes, vide : tout le reste) ; `amount_due` = reste à payer ; cotisation minimale de la table ramenée à 100 (celle des Paramètres s’applique) |
| `…200000_rythme_journalier.sql`, `…200100_duree_tour.sql` | Rythme de cotisation `daily`/`weekly`/`biweekly`/`monthly` et `turn_length` (durée d’un tour en périodes du rythme, choisie par l’admin ; un an au plus, deux ans en mensuel) |

- RLS est activé sur toutes les tables (règles : étape 3 ci-dessous).
- Le schéma `private` n’est pas exposé par l’API (accès `service_role` seulement).
- Les modèles de SMS en wolof sont un premier jet, à faire relire avant tout envoi réel.

## Règles d’accès (étape 3)

Migration `…140000_rls.sql`, testée par `supabase/tests/database/rls.test.sql` (35 tests).

- **Clé publique (`anon`)** : aucune table. Tout ce qui précède la connexion passe par les
  Edge Functions.
- **Compte connecté** : lecture de ce qui le concerne ; écriture directe seulement de son
  profil (prénom, nom, photo, numéro de versement, langue, préférences), de « lu » sur ses
  notifications et de ses abonnements push. Le reste passe par des RPC / Edge Functions.
- **Compte suspendu ou supprimé** : ne voit plus rien.
- **Gérer un groupe** = super admin, admin responsable (`admin_id`), propriétaire ou co-admin
  actif. Être admin d’une communauté ne donne aucun droit sur ses groupes.
- **Numéros** : visibles seulement par soi-même, les gestionnaires du groupe et le super
  admin. Les autres membres ont nom et photo via `public_profiles(ids)`.
- **Paramètres** : complets pour le super admin ; `public_settings()` donne aux autres les
  frais, limites et textes, sans aucun indice de clé.
- Journal de sécurité, revenus, relevé PayTech, SMS : super admin seulement.
- Le tableau de bord super admin du frontend lit ses indicateurs depuis Supabase avec la session
  authentifiée ; `admin_pin_pending` vérifie le rôle côté base avant de renvoyer le statut des PIN.
- La fonction `admin-create` vérifie le super admin côté serveur, crée un compte Auth avec son
  identifiant interne si nécessaire, enregistre/promouvoit son profil et trace l’action. Le nouvel
  administrateur se connecte ensuite par code SMS et choisit son PIN.

## Connexion (étape 4)

Migration `…150000_connexion.sql` (opérations atomiques, appelables par `service_role`
seulement) et 9 Edge Functions :

| Fonction | Entrée → sortie |
|---|---|
| `auth-login-method` | `{ phone }` → `{ method: 'pin' \| 'otp' }` |
| `auth-otp-send` | `{ phone, inviteCode? }` → `{ ok }` (5 codes par numéro et par heure, 20 par adresse IP). Numéro sans compte : refusé (404, « Contactez votre administrateur ») sauf avec le code d’invitation d’un groupe pas encore démarré, ou à la demande du super admin connecté (changement de numéro) |
| `auth-otp-verify` | `{ phone, code }` → `{ isNewAccount, firstName, hasPin, proofToken }` |
| `auth-profile-create` | `{ proofToken, firstName, lastName }` → `{ ok }` |
| `auth-pin-set` | `{ proofToken, pin }` (ou session sans PIN) → `{ session, user }` |
| `auth-pin-login` | `{ phone, pin }` → `{ session, user }` |
| `auth-pin-change` | session + `{ currentPin, newPin }` → `{ ok }` |
| `admin-pin-reset` | session super admin + `{ userId }` → `{ ok }` (ferme ses sessions et le prévient) |
| `payments-initiate` | session + `{ roundId, method }` → `{ paymentId, checkoutUrl }` (page PayTech ; sans clés et en local : page simulée) |
| `payments-ipn` | notification PayTech (sans session) : signature HMAC-SHA256 ou empreintes SHA-256 des clés, montant exact, idempotente |
| `payments-simulate` | session + `{ paymentId, success }` : en local et sans clés PayTech seulement |
| `announcement-send` | session super admin + `{ target, title, message }` → `{ count, smsFailed }` (notifications + un SMS par destinataire) |
| `member-create` | session super admin + `{ firstName, lastName, phone }` → `{ id }` (compte participant ; 1re connexion : code SMS puis PIN) |
| `member-phone-change` | session super admin + `{ userId, phone, code }` → `{ ok }` (le code SMS a été envoyé au nouveau numéro par `auth-otp-send`, appelé par le super admin) |
| `admin-create` | session super admin + `{ firstName, lastName, phone }` → `{ ok }` (nomme un compte existant ou prépare un compte neuf) |

Erreurs : `{ error: { code, message } }`, avec les codes du frontend (`invalid`, `conflict`…)
et un message en français à afficher tel quel. Côté frontend, `verifyOtp` garde le
`proofToken` en mémoire pour `completeProfile` et `setPin` ; `session` va dans
`supabase.auth.setSession`.

- Codes SMS : empreinte HMAC seulement, 10 minutes, 5 essais, usage unique.
- PIN : Argon2id sur un HMAC du PIN avec le poivre ; l’essai est compté **avant** la
  vérification (impossible de tester plus de PIN que permis, même en parallèle) ; au-delà de
  `security.maxPinAttempts`, seul un code SMS permet d’en créer un nouveau.
- La session ne s’ouvre qu’après le PIN ; le PIN n’est jamais un mot de passe Supabase.
- `[auth.email] enable_signup` doit rester à `true` (sinon la connexion interne par e-mail
  est coupée) ; les inscriptions publiques restent bloquées par `[auth] enable_signup = false`.

**Essayer en local** : dans `supabase/functions/.env`, `SMS_MODE=console` écrit les SMS dans
les journaux de `npm run functions` au lieu de les envoyer (refusé hors de la machine locale).
Comptes du seed : ceux de la simulation (super admin 770100101, admin 771234567, membre
772345678…), **sans PIN** : numéro → code lu dans les journaux → création du PIN.

## Choix de configuration

- **Pas d’inscription publique** (`enable_signup = false`) : les comptes sont créés par nos
  Edge Functions après le code SMS.
- **Identifiant interne** : dans Supabase Auth, chaque compte a un e-mail technique
  `<uuid>@users.calebasse.invalid` et un mot de passe interne recalculé à la demande
  (`HMAC(SESSION_PEPPER, user_id)`, jamais stocké). Ils servent uniquement à ouvrir la session
  après un PIN correct ; aucun e-mail n’est envoyé, le vrai numéro est dans `profiles`.
  Ainsi, la connexion téléphone de Supabase (qui exige un fournisseur SMS intégré) n’est pas
  utilisée : les SMS passent par Orange.
- **Jeton d’accès de 15 minutes**, renouvelé pendant l’utilisation.
- **Notifications push, pas de SMS** : les rappels, annonces, paiements, échanges… arrivent
  sur le téléphone comme une messagerie (Web Push). Seul le code de connexion part par SMS.
  Réglage par environnement : clés `VAPID_*` et `PUSH_SECRET` dans les secrets des fonctions,
  `VITE_VAPID_PUBLIC_KEY` dans le frontend, et dans le coffre-fort Vault de la base :
  `select vault.create_secret('<adresse>/functions/v1/push-send', 'push_send_url');`
  `select vault.create_secret('<même valeur que PUSH_SECRET>', 'push_send_secret');`
  En local, l’adresse est `http://kong:8000/functions/v1/push-send` (à refaire après `npm run reset`).
  Sur iPhone, le push n’arrive que si l’application est installée sur l’écran d’accueil.
- **Secrets** : uniquement dans `supabase/functions/.env` (local) ou
  `npx supabase secrets set` (production). Jamais dans le code ni dans le dépôt.

## Ordre de travail

| Étape | Contenu | État |
|---|---|---|
| 1 | Initialisation : projet, structure, secrets, README | ✅ |
| 2 | Schéma : types, tables, index, triggers ; types TypeScript générés | ✅ |
| 3 | RLS : fonctions d’aide, politiques, vues, tests pgTAP | ✅ |
| 4 | Connexion : code SMS (Orange) et PIN, profil, seed | ✅ côté serveur (branchement du frontend : avec les autres services) |
| 5 | Groupes, communautés, adhésions, parts, tirage et ordre | ✅ groupes, communautés, adhésions, supervision (testés : `groupes.test.sql`, `communautes.test.sql`, et `npm run test:integration` côté frontend) ; tirage et ordre : avec l’étape 6 |
| 6 | Cycle : démarrage, tours, verrouillage, échanges de tour | ✅ ordre, démarrage, tours, espèces, versement, période réservée, nouveau cycle (`cycle.test.sql` et `npm run test:integration`) ; échanges de tour ✅ (`echanges.test.sql`) |
| 7 | Notifications : `notify`, `push-send`, abonnements | ✅ push à chaque notification (chaîne testée en local) ; relances et annonces sans SMS ; à faire : essai sur un vrai téléphone (HTTPS) |
| 8 | Tâche quotidienne `cron-daily` | à faire |
| 9 | Paiements PayTech (frais payés par le membre), espèces, pénalités | ✅ circuit PayTech complet, testé sans clés (page simulée) ; espèces ✅ ; à faire : test avec les clés PayTech (env test), pénalités automatiques (étape 8) |
| 10 | Versements (transfert PayTech ou manuel), revenus, rémunérations | à faire |
| 11 | Back-office : litiges, annonces, rapports, journaux, paramètres | ✅ (`super_admin.test.sql`, `npm run test:integration`) ; à faire : écran de réclamation côté membre |
| 12 | Déploiement : projet de test, secrets, GitHub Actions | à faire |

Chaque étape se termine par un parcours qui fonctionne à l’écran avec le frontend.
