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

Trois migrations dans `supabase/migrations/` :

| Fichier | Contenu |
|---|---|
| `…130000_schema_comptes_groupes.sql` | `profiles`, `communities`, `community_admins`, `groups`, `memberships` (une ligne par part ; une demande d’adhésion = ligne `pending`) |
| `…130100_schema_tours_paiements.sql` | `rounds`, `round_beneficiaries`, `payments` (avec `service_fee_amount`), `penalties`, `platform_earnings`, `admin_compensations`, `swap_requests` |
| `…130200_schema_backoffice.sql` | `notifications`, `push_subscriptions`, `audit_log` et `security_events` (ajout seul), `disputes`, `dispute_events`, `provider_ledger`, `sms_log`, `platform_settings` (une ligne, modèles en `fr` et `wo`) ; schéma `private` : `auth_otps`, `auth_pins` |

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

## Connexion (étape 4)

Migration `…150000_connexion.sql` (opérations atomiques, appelables par `service_role`
seulement) et 8 Edge Functions :

| Fonction | Entrée → sortie |
|---|---|
| `auth-login-method` | `{ phone }` → `{ method: 'pin' \| 'otp' }` |
| `auth-otp-send` | `{ phone }` → `{ ok }` (5 codes par numéro et par heure, 20 par adresse IP) |
| `auth-otp-verify` | `{ phone, code }` → `{ isNewAccount, firstName, hasPin, proofToken }` |
| `auth-profile-create` | `{ proofToken, firstName, lastName }` → `{ ok }` |
| `auth-pin-set` | `{ proofToken, pin }` (ou session sans PIN) → `{ session, user }` |
| `auth-pin-login` | `{ phone, pin }` → `{ session, user }` |
| `auth-pin-change` | session + `{ currentPin, newPin }` → `{ ok }` |
| `admin-pin-reset` | session super admin + `{ userId }` → `{ ok }` (ferme ses sessions) |

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
- **Secrets** : uniquement dans `supabase/functions/.env` (local) ou
  `npx supabase secrets set` (production). Jamais dans le code ni dans le dépôt.

## Ordre de travail

| Étape | Contenu | État |
|---|---|---|
| 1 | Initialisation : projet, structure, secrets, README | ✅ |
| 2 | Schéma : types, tables, index, triggers ; types TypeScript générés | ✅ |
| 3 | RLS : fonctions d’aide, politiques, vues, tests pgTAP | ✅ |
| 4 | Connexion : code SMS (Orange) et PIN, profil, seed | ✅ côté serveur (branchement du frontend : avec les autres services) |
| 5 | Groupes, communautés, adhésions, parts, tirage et ordre | à faire |
| 6 | Cycle : démarrage, tours, verrouillage, échanges de tour | à faire |
| 7 | Notifications : `notify`, `push-send`, abonnements | à faire |
| 8 | Tâche quotidienne `cron-daily` | à faire |
| 9 | Paiements PayTech (frais payés par le membre), espèces, pénalités | à faire |
| 10 | Versements (transfert PayTech ou manuel), revenus, rémunérations | à faire |
| 11 | Back-office : litiges, annonces, rapports, journaux, paramètres | à faire |
| 12 | Déploiement : projet de test, secrets, GitHub Actions | à faire |

Chaque étape se termine par un parcours qui fonctionne à l’écran avec le frontend.
