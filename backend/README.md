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
npm run test:db                   # tests pgTAP
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
| 2 | Schéma : types, tables, index, triggers ; types TypeScript générés | à faire |
| 3 | RLS : fonctions d’aide, politiques, vues, tests pgTAP | à faire |
| 4 | Connexion : code SMS (Orange) et PIN, profil, seed | à faire |
| 5 | Groupes, communautés, adhésions, parts, tirage et ordre | à faire |
| 6 | Cycle : démarrage, tours, verrouillage, échanges de tour | à faire |
| 7 | Notifications : `notify`, `push-send`, abonnements | à faire |
| 8 | Tâche quotidienne `cron-daily` | à faire |
| 9 | Paiements PayTech (frais payés par le membre), espèces, pénalités | à faire |
| 10 | Versements (transfert PayTech ou manuel), revenus, rémunérations | à faire |
| 11 | Back-office : litiges, annonces, rapports, journaux, paramètres | à faire |
| 12 | Déploiement : projet de test, secrets, GitHub Actions | à faire |

Chaque étape se termine par un parcours qui fonctionne à l’écran avec le frontend.
