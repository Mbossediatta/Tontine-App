# Cahier des charges — Intégration du backend au frontend

**Calebasse de l’Espoir · PWA Tontine** — version du 5 novembre 2026

Ce document est destiné à la personne (ou à Claude dans VS Code) qui construit le backend
Supabase et le branche sur le frontend existant. Il **complète** le *Cahier des charges
Backend – PWA Tontine* du 2 novembre 2026 (PDF à la racine du dépôt) : le frontend a
beaucoup évolué depuis, et c’est lui qui fixe maintenant le contrat.

**Ordre de priorité en cas de conflit :**
1. le code du frontend (`src/services/*.service.ts`, `src/types/`) ;
2. ce document ;
3. [`CONTRAT-BACKEND.md`](CONTRAT-BACKEND.md) (liste exhaustive des 100 fonctions et des
   137 règles, tirée du code) ;
4. le cahier backend du 2 novembre (stack, sécurité, tâches planifiées, structure des paiements :
   toujours valables sauf écart signalé ici — en particulier **PayTech remplace PayDunya**).

Si une règle paraît ambiguë, **la poser avant de coder**, comme le demandait le cahier d’origine.

### Décisions prises le 5 novembre 2026

| Sujet | Décision |
|---|---|
| Prestataire de paiement | **PayTech** (paytech.sn), à la place de PayDunya (4.7) |
| Frais de paiement | **Payés par le membre** qui paie dans l’appli, en plus de sa cotisation, jamais pris sur la cagnotte (4.7) |
| Fournisseur SMS | **Orange** (API SMS Sénégal) (4.10) |
| Wolof | Pour l’**espace des membres** (écrans, SMS et notifications des participants) ; le back-office reste en français (4.10) |
| Vérification du PIN | Code SMS et PIN vérifiés par nos Edge Functions ; session ouverte seulement après le PIN (4.1) |

---

## 1. Point de départ : le frontend est prêt

| Élément | État |
|---|---|
| Écrans | 37 routes, 3 rôles (participant, admin, super admin), téléphone et ordinateur |
| Données | Couche simulée complète (`src/services/mock/`), même comportement que le futur backend |
| Contrat | 15 interfaces de service, ~100 fonctions, toutes typées |
| Qualité | TypeScript strict, ESLint sans erreur, 113 tests, build sans avertissement |
| Exploration | 76 pages visitées automatiquement : aucune erreur, aucun débordement |
| Lighthouse (connexion) | Accessibilité 100, bonnes pratiques 100, SEO 100, performance 77–80 |
| Déploiement | Vercel, mode démonstration (`VITE_USE_MOCKS=true`) |

**Le frontend ne doit presque pas changer.** L’intégration consiste à écrire, pour chaque
interface de service, une implémentation Supabase qui respecte exactement le même contrat.

---

## 2. Principe d’intégration

### 2.1 Un seul point de bascule

- Créer `src/services/supabase/` avec une implémentation par interface
  (`auth.supabase.ts`, `group.supabase.ts`…), sur le modèle de `src/services/mock/`.
- Dans `src/services/index.ts`, choisir l’implémentation selon `env.useMocks`.
  Utiliser `import.meta.env.VITE_USE_MOCKS === 'true'` directement dans la condition, pour que
  la simulation **disparaisse du build de production** (c’est déjà fait ainsi pour les comptes
  de démonstration ; la simulation pèse 159 Ko dans le fichier principal).
- Client Supabase unique dans `src/lib/supabase.ts` (`@supabase/supabase-js`, à installer),
  avec `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`.

### 2.2 Ce que chaque implémentation doit respecter

| Sujet | Règle |
|---|---|
| Noms | La base est en `snake_case`, le frontend en `camelCase` : la conversion se fait dans la couche service, jamais dans les écrans. |
| Types | Les fonctions renvoient exactement les types de `src/types/` (y compris les vues composées de `views.ts`). Générer `src/types/database.ts` avec `supabase gen types`, mais ne pas remplacer les types métier. |
| Erreurs | Toute erreur devient un `ServiceError` (`src/lib/errors.ts`) : message en français affiché tel quel, et un code. Voir 2.3. |
| Montants | Entiers en FCFA. |
| Dates | ISO 8601 en UTC ; le fuseau d’affichage est celui de Dakar (UTC+0). |
| Téléphones | 9 chiffres sans indicatif côté frontend (`772345678`) ; la base peut stocker `+221772345678`, la conversion se fait dans la couche service. |
| Hors ligne | Lever `ServiceError('Connexion requise…', 'offline')` quand `navigator.onLine` est faux, comme la simulation (`requireOnline`). |

### 2.3 Codes d’erreur

Le cahier du 2 novembre prévoit des codes métier (`groupe_complet`, `compte_suspendu`…).
Les garder côté serveur, et les traduire vers les codes du frontend :

| Code frontend | Codes backend correspondants (exemples) |
|---|---|
| `offline` | pas de réseau |
| `unauthenticated` | session absente ou expirée, `jwt_expired` |
| `forbidden` | `non_autorise`, `compte_suspendu`, PIN bloqué |
| `not_found` | élément introuvable |
| `invalid` | valeur hors limites, saisie refusée (texte suspect) |
| `conflict` | `groupe_complet`, `cycle_deja_demarre`, `paiement_deja_effectue`, `tour_non_pret`, PIN à recréer |

Le **message** reste celui du serveur, en français ; les 137 messages attendus sont listés en
annexe de [`CONTRAT-BACKEND.md`](CONTRAT-BACKEND.md).

---

## 3. Écarts avec le cahier backend du 2 novembre

Ce tableau résume tout ce que le frontend fait aujourd’hui et que le cahier d’origine ne
prévoyait pas (ou prévoyait autrement). Chaque ligne est détaillée dans la section 4.

| Domaine | Cahier du 2 novembre | Frontend actuel |
|---|---|---|
| Connexion | OTP SMS uniquement (Supabase Auth) | **Code SMS puis code PIN à 4 chiffres**, vérifiés par nos Edge Functions ; ensuite PIN seul ; blocage après N erreurs |
| Paiement | PayDunya | **PayTech** |
| Frais de paiement | `fees_paid_by` à trancher | **Payés par le membre**, affichés avant le paiement, hors cagnotte (`service_fee_amount`) |
| SMS | Twilio | **Orange** (API SMS Sénégal) |
| Organisation | Groupes seuls | **Communautés** regroupant des groupes, avec leurs admins |
| Admin d’un groupe | Propriétaire / co-admins | **`admin_id`** (admin responsable, indépendant des admins de communauté) + propriétaire / co-admins |
| Parts | 1 personne = 1 place | **Plusieurs parts par personne** (plusieurs adhésions actives) |
| Tours | 1 bénéficiaire par tour | **Plusieurs parts payées par tour** (`shares_per_round`), **période finale réservée à la plateforme** |
| Cotisation | Montant par période | Montant par période **ou par jour** (`daily_contribution`, `turn_duration_days`) |
| Frais | — | **Frais d’adhésion** (une seule fois), pénalités, revenus de la plateforme, rémunération des admins |
| Cycles | Un seul cycle | **Plusieurs cycles** (`current_cycle`, relance d’un cycle) |
| Statut de groupe | draft, active, finished | + **suspended**, **archivage** (`archived_at`), **clôture** |
| Tours | — | **Échanges de tour** entre membres (validés par l’admin) |
| Versements | Reversement direct | + **blocage / déblocage** d’un versement avec motif, validation tracée |
| Back-office | Page Administrateurs | **12 rubriques** : transactions, réconciliation, versements, litiges, annonces, rapports, audit, **sécurité**, paramètres… |
| Paramètres | — | **Paramètres de la plateforme** ; **clés secrètes en écriture seule** |
| Journal | `audit_log` | `audit_log` + **`security_events`** (PIN, OTP, accès refusés, saisies suspectes) |
| Photo | Bucket `avatars` | Idem ; le frontend envoie aujourd’hui l’image en *data URL* (voir 4.12) |
| Langue | Hors périmètre | **Wolof pour l’espace des membres** (commencé à l’écran) ; SMS et push des membres dans leur langue |
| Listes | Sans pagination | **Pagination serveur nécessaire** pour 10 listes (voir 4.15) |

---

## 4. Exigences détaillées

### 4.1 Connexion : SMS, puis code PIN

Parcours déjà en place à l’écran (`src/features/auth/`) :

1. Numéro de téléphone →
   - **sur téléphone** : code SMS ;
   - **sur ordinateur** : `loginMethod(phone)` répond `'pin'` si le compte a un PIN utilisable,
     sinon `'otp'`. **Ne jamais renvoyer le prénom ni aucune autre donnée** à cette étape.
2. Code SMS (6 chiffres, aléatoire, usage unique, valable `security.otpValidityMinutes`) →
   prouve le numéro ; **la session n’est pas encore ouverte**.
3. Numéro inconnu → profil (prénom, nom, photo facultative) → création du PIN.
4. PIN : créé (première fois, oublié, bloqué ou réinitialisé) ou saisi → **ouvre la session**.

Règles du PIN :
- 4 chiffres ; les PIN trop simples sont refusés (`0000`, `1234`, `4321`…) — règle dans
  `src/lib/checks.ts` (`isWeakPin`), à reproduire côté serveur.
- Stocké en **empreinte lente** (Argon2id ou bcrypt), jamais en clair, jamais renvoyé.
- Après `security.maxPinAttempts` erreurs consécutives (5 par défaut) : PIN bloqué ; seul un
  nouveau code SMS permet d’en créer un autre. Messages : « PIN incorrect. Il vous reste N
  essais. », puis « PIN bloqué après 5 essais… ».
- Le super admin peut forcer la réinitialisation (`memberService.resetPin`).
- `changePin` exige le PIN actuel, avec les mêmes règles d’essais.

#### Méthode retenue : code SMS et PIN vérifiés par nos Edge Functions, session Supabase ouverte seulement après le PIN

**Pourquoi pas les solutions toutes faites :**
- *OTP téléphone de Supabase Auth* : il ouvre une session **dès le code SMS**, alors que la
  session ne doit s’ouvrir qu’après le PIN ; et Orange n’est pas un fournisseur intégré.
- *PIN utilisé comme mot de passe Supabase* : 4 chiffres = 10 000 combinaisons, et l’adresse
  de connexion par mot de passe de Supabase permettrait de les essayer **en contournant notre
  compteur d’essais**. Refusé.

**Principe :** Supabase Auth ne sert qu’à émettre les jetons (JWT) qui portent les règles
RLS. Le code SMS et le PIN sont vérifiés par nos propres Edge Functions, qui ouvrent la
session Supabase **uniquement après un PIN correct**, avec un mot de passe interne que
personne ne connaît.

**Tables** (schéma `private`, jamais exposé à l’API ; accès `service_role` uniquement) :
- `auth_otps (phone, code_hash, expires_at, attempts, used_at, created_at)` ;
- `auth_pins (user_id, pin_hash, failed_attempts, must_reset, updated_at)`.

**Secrets** : `OTP_PEPPER`, `PIN_PEPPER`, `SESSION_PEPPER`, `PROOF_TOKEN_SECRET`.

**Edge Functions et rôle de chacune :**

| Fonction | Entrée | Ce qu’elle fait |
|---|---|---|
| `auth-otp-send` | numéro | Limite : 5 codes par numéro et par heure, et par adresse IP. Tire un code à 6 chiffres (générateur cryptographique), stocke son **empreinte HMAC** (`OTP_PEPPER`), l’envoie par **Orange** (4.10), note le SMS dans `sms_log`. Répond pareil que le numéro existe ou non. |
| `auth-otp-verify` | numéro, code | 5 essais au plus par code, code à usage unique, expiré après `security.otpValidityMinutes`. Échec → `security_events` (`otp_failed`). Succès → renvoie `isNewAccount`, `firstName`, `hasPin` et un **jeton de preuve** (signé `PROOF_TOKEN_SECRET`, valable 10 min, limité à ce numéro). |
| `auth-profile-create` | jeton de preuve, prénom, nom | Crée l’utilisateur Supabase (`auth.admin.createUser`, téléphone confirmé) avec le **mot de passe interne** (voir plus bas) et la ligne `profiles`. |
| `auth-pin-set` | jeton de preuve, PIN | Refuse les PIN trop simples, enregistre l’empreinte **Argon2id** du PIN combiné à `PIN_PEPPER`, remet le compteur à zéro, puis **ouvre la session**. |
| `auth-pin-login` | numéro, PIN | Lit et met à jour `auth_pins` **dans une même transaction** (`select … for update`) ; compare en temps constant ; erreur → compteur + `security_events` (`pin_failed`) ; au-delà de `security.maxPinAttempts` → `must_reset` + `pin_blocked`. Succès → compteur à zéro, puis **ouvre la session**. Sert aussi au déverrouillage de l’appli. |
| `auth-pin-change` | session, PIN actuel, nouveau PIN | Mêmes règles d’essais que `auth-pin-login`. |
| `auth-login-method` | numéro | Répond seulement `'pin'` ou `'otp'` (connexion sur ordinateur). |
| `admin-pin-reset` | session super admin, utilisateur | `must_reset = true`, **révoque toutes les sessions** de la personne (`auth.admin.signOut`), trace dans `audit_log` (`pin_reset`). |

**Ouvrir la session :** le mot de passe interne n’est **jamais stocké** : il est recalculé à la
demande, `HMAC-SHA256(SESSION_PEPPER, user_id)` (256 bits, impossible à deviner). L’Edge
Function appelle `signInWithPassword(téléphone, mot de passe interne)` et renvoie au frontend
les jetons (`access_token`, `refresh_token`). Personne, même avec l’adresse de connexion
directe de Supabase, ne peut ouvrir une session sans passer par le PIN.

**Durcissement :**
- jeton d’accès court (15 minutes) ; la session se renouvelle normalement pendant
  l’utilisation, et le PIN est redemandé à chaque ouverture sur téléphone et après
  inactivité (déjà géré par l’écran) ;
- messages d’erreur génériques (ne pas dire si un numéro existe) ;
- limite d’appels par adresse IP sur toutes ces fonctions ;
- aucun code, PIN ou jeton dans les journaux ;
- un compte suspendu ne reçoit ni code ni session.

**Côté frontend :** `authService` garde exactement la même interface ; l’implémentation
Supabase appelle ces Edge Functions puis enregistre la session avec
`supabase.auth.setSession(tokens)`.

Comportement côté écran à conserver (aucune action backend, pour information) :
- téléphone : compte retenu, application verrouillée à chaque ouverture et après
  `security.inactivityLockMinutes` d’inactivité ;
- ordinateur : rien n’est retenu, une session restée ouverte est fermée au lancement ;
- aller-retour vers la page de paiement : pas de PIN redemandé (`src/lib/paymentRedirect.ts`).

### 4.2 Rôles et droits

- Rôle global : `super_admin`, `admin`, `user`. Rôle dans un groupe : `owner`, `co_admin`,
  `member`.
- Peut gérer un groupe : le super admin, **l’admin responsable (`groups.admin_id`), même s’il
  n’y cotise pas**, le propriétaire et les co-admins actifs (`src/services/mock/access.ts`,
  `canManage`).
- **Admin de communauté ≠ admin de groupe** : être admin d’une communauté ne donne aucun droit
  sur ses groupes. Un admin ne crée des groupes que dans ses communautés ; il peut confier le
  groupe à un autre admin actif (il n’y a alors plus accès et n’en est pas membre).
- Le super admin confie un groupe à n’importe quel admin actif ; il n’y cotise pas.
- Chaque refus d’accès est noté dans `security_events` (`access_denied`).
- Un compte suspendu ne peut plus rien faire (cahier du 2 novembre, inchangé).

### 4.3 Communautés

Tables : `communities (id, name, description, created_at)` et
`community_admins (community_id, admin_id)`.
- Nom de 2 à 60 caractères, unique (insensible à la casse) ; description ≤ 300 caractères ;
  au moins un admin actif.
- Groupes : `groups.community_id`, `groups.join_policy` (`invite` ou `community`).
- `listDiscoverable` : groupes `join_policy = 'community'` des communautés dont l’utilisateur
  est membre d’au moins un groupe ; `requestJoinOpen` pour y demander l’adhésion.
- Transfert d’un groupe vers une autre communauté (`transferGroup`) : notifie les membres.

### 4.4 Groupes : nouveaux champs

À ajouter à la table `groups` du cahier d’origine :

| Colonne | Rôle |
|---|---|
| `community_id` | Communauté du groupe |
| `admin_id` | Administrateur responsable (obligatoire) |
| `join_policy` | `invite` ou `community` |
| `daily_contribution` (bool) | Cotisation par jour et par part |
| `turn_duration_days` (int, défaut 10) | Durée d’une période / d’un tour, en jours |
| `shares_per_round` (int, défaut 1) | Nombre de parts payées dans un tour |
| `membership_fee_amount` (int, défaut 0) | Frais d’adhésion, facturés une seule fois par personne |
| `reserve_final_turn` (bool) | Dernière période réservée à la plateforme |
| `member_status_visibility` | `members` ou `admins` : qui voit le statut de paiement des autres |
| `current_cycle` (int, défaut 1) | Numéro du cycle en cours |
| `archived_at` | Groupe terminé rangé aux archives |
| `status` | + valeur `suspended` (paiements et versements gelés) |

Limites du montant et du nombre de parts : celles des **paramètres de la plateforme**
(`rules.minContribution`, `maxContribution`, `maxMembers`), plus celles du cahier d’origine.
Après démarrage : montant, fréquence, nombre de parts et ordre verrouillés (inchangé).

### 4.5 Parts multiples

- Une personne peut avoir **plusieurs parts** dans un groupe : une ligne `memberships` active
  par part. **Retirer la contrainte `unique (group_id, user_id)`** du cahier d’origine ; garder
  `unique (group_id, payout_order)`.
- `addByPhone(groupId, phone, shareCount)` attribue N parts en une opération.
- La cotisation d’une personne = cotisation par part × nombre de parts
  (× `turn_duration_days` si cotisation journalière) + pénalité + frais d’adhésion non encore
  payés. Calcul de référence : `amountBreakdown` dans `src/services/mock/lifecycle.ts`.

### 4.6 Tours

Calcul de référence : `createRounds` dans `src/services/mock/lifecycle.ts`. Écarts :
- les parts actives, triées par `payout_order`, sont regroupées par paquets de
  `shares_per_round` : **un tour peut avoir plusieurs bénéficiaires** ;
- si `reserve_final_turn`, un dernier tour **revient à la plateforme**
  (`recipient_type = 'platform'`) : à la clôture, son montant est crédité dans
  `platform_earnings` (`reserved_turn`) ;
- cotisation journalière : ouverture tous les `turn_duration_days` jours, date limite à
  ouverture + `turn_duration_days` ;
- en retard après `due_date + rules.graceDays`.

Colonnes à ajouter à `rounds` : `cycle`, `recipient_type`, `payout_validated_by`,
`payout_blocked_at`, `payout_block_reason` ; et une table
`round_beneficiaries (round_id, membership_id, amount)` (remplace `beneficiary_id` unique et
`beneficiaryAmounts`).

**Relance d’un cycle** (`restartCycle`) : nouveau numéro de cycle, nouvelles dates, mêmes
membres ou membres choisis ; les tours de l’ancien cycle restent consultables.

**Échanges de tour** (`swapService`) : table `swap_requests` (statuts `pending_partner`,
`pending_admin`, `approved`, `rejected`, `cancelled`) ; le partenaire accepte, puis l’admin
valide ; à l’approbation, les bénéficiaires des deux tours sont échangés.

### 4.7 Paiements

- Détail du montant dans `payments` : `contribution_amount`, `membership_fee_amount`,
  `late_penalty_amount` (en plus du `amount` total).
- Pénalités dans une table `penalties (round_id, user_id, amount, applied_at)`, une seule par
  personne et par tour, appliquées par `cron-daily`.
- `getReceipt(paymentId)` alimente le reçu téléchargeable (PDF généré côté frontend).
- Paiement en espèces (`recordCash`) et relances (`remindLate`, `remindMember`) : inchangés.
  Un paiement en espèces n’a pas de frais de paiement.

#### Frais de paiement : payés par le membre

- Le membre paie **sa cotisation + les frais du prestataire**. Les frais ne sont **jamais**
  pris sur la cagnotte, et la cagnotte reçoit toujours le montant complet.
- Calcul : `service_fee = arrondi au franc supérieur (montant × payment.feePercent / 100)`
  (`serviceFee` dans `src/lib/tontine.ts`). `payment.feePercent` (paramètres de la plateforme)
  doit être réglé sur la **commission réelle de PayTech** ; c’est le serveur qui fait foi.
- Colonne `payments.service_fee_amount` (champ `serviceFeeAmount`). `amount` reste le montant
  destiné à la tontine (cotisation + pénalité + frais d’adhésion) : toute la comptabilité
  (collecté, cagnotte, rapports) s’appuie dessus. Montant débité = `amount + service_fee_amount`.
- La vue du groupe renvoie `myServiceFee` (frais sur le montant dû). L’écran « Payer » affiche
  déjà : Cotisation, (Pénalité), (Frais d’adhésion), **Frais de paiement**, **Total**, et le
  bouton « Payer [total] ». Le reçu indique « Dont frais de paiement ».

#### Parcours PayTech (`payments-initiate` puis `payments-ipn`)

Référence : documentation officielle PayTech (doc.paytech.sn). **Vérifier chaque nom de champ
et d’adresse dans la documentation à jour avant de coder** ; ceux ci-dessous viennent du guide
d’intégration PayTech et peuvent avoir évolué.

1. Le frontend appelle `payments-initiate` avec `{ roundId, method }`.
2. La fonction vérifie : membre actif, groupe non suspendu, tour ouvert ou paiement en retard,
   pas déjà payé, versement non bloqué. Elle calcule `amount` (`amountBreakdown`) et
   `service_fee_amount`.
3. Elle crée (ou réutilise) la ligne `payments` en `pending`, puis demande un paiement à PayTech
   (en-têtes `API_KEY` et `API_SECRET`, gardés dans les secrets Supabase) avec :
   - `item_name` / `command_name` : « Cotisation [groupe] – tour [n] » ;
   - `item_price` : **`amount + service_fee_amount`** ;
   - `currency` : `XOF` ;
   - `ref_command` : l’identifiant du paiement ;
   - `custom_field` : `{ "payment_id": "…" }` ;
   - `env` : `test` ou `prod` (selon `payment.mode`) ;
   - `ipn_url` : adresse de `payments-ipn` ;
   - `success_url` : `APP_URL/paiement/succes?payment=<id>` ;
   - `cancel_url` : `APP_URL/paiement/echec?payment=<id>`.
   Elle enregistre le `token` PayTech et renvoie `{ paymentId, checkoutUrl }` (l’adresse de la
   page de paiement PayTech).
4. `payments-ipn` reçoit la notification de PayTech et **vérifie qu’elle vient bien de
   PayTech** : `api_key_sha256` = SHA-256 de notre `API_KEY` et `api_secret_sha256` = SHA-256 de
   notre `API_SECRET` (comparaison en temps constant). Ces empreintes ne changent jamais : si
   la documentation à jour propose une signature plus forte (HMAC) ou une adresse de
   vérification du statut, **l’utiliser en plus**.
5. Elle vérifie ensuite que `ref_command` / `custom_field` désignent un paiement existant, que
   `item_price` est **exactement** le montant attendu, et que l’événement est un paiement
   réussi. Sinon : rien ne change, l’appel est journalisé (et `security_events` si l’empreinte
   est fausse).
6. Paiement confirmé : `status = 'paid'`, `paid_at`, moyen, `provider_ref` ; notification au
   membre ; passage du tour à `ready_for_payout` si tout le monde a payé (inchangé).
7. **Idempotence** : un paiement déjà `paid` ne change pas ; toujours répondre `200` une fois la
   notification traitée.

**Mode test :** avec `env = test`, PayTech ne débite que **100 FCFA** quel que soit le montant :
en test, comparer `item_price` au montant attendu **sans** exiger que le débit réel
corresponde. En local, garder une route de simulation (`payments-ipn?simulate=paid`, acceptée
seulement en mode test), comme le prévoyait le cahier d’origine.

**Retour à l’appli :** aucun changement côté frontend ; le retour de paiement ne redemande pas
le PIN (`src/lib/paymentRedirect.ts`) et l’écran de succès interroge le statut toutes les 3 s
pendant 60 s.

**Moyens de paiement :** le frontend propose Wave et Orange Money (et Free Money côté admin).
Vérifier les moyens activés sur le compte PayTech et le nom renvoyé dans `payment_method` pour
le convertir vers `wave` / `orange_money` / `free_money`.

### 4.8 Versements, revenus et rémunérations

- `financeService.payouts()` : tous les tours avec leur étape (`upcoming`, `collecting`,
  `ready`, `blocked`, `paid`), le collecté et l’attendu.
- **Blocage / déblocage** d’un versement par le super admin, avec motif (≥ 4 caractères) :
  un tour bloqué ne peut pas être reversé.
- **Revenus de la plateforme** : table `platform_earnings` (`membership_fee`, `late_penalty`,
  `reserved_turn`).
- **Rémunération des admins** : table `admin_compensations` ; facultative, plafonnée aux
  revenus disponibles du groupe concerné.
- **Réconciliation** (`reconciliation(month)`) : compare les encaissements enregistrés au
  relevé du prestataire (table `provider_ledger`, alimentée par les notifications et le relevé
  PayTech) ; renvoie attendu, enregistré en ligne, espèces, relevé, rapprochés et écarts. Le
  relevé PayTech contient les montants débités (**frais compris**) : rapprocher avec
  `amount + service_fee_amount`.
- **Reversement de la cagnotte** (`roundService.payout` → `payouts-create` / `payouts-ipn`) :
  utiliser l’**API de transfert de PayTech** vers le portefeuille du bénéficiaire (Wave ou
  Orange Money, `payoutPhone` / `payoutMethod` du profil). Le guide d’intégration consulté ne
  décrit que l’encaissement : **vérifier dans la documentation PayTech à jour** l’adresse du
  transfert et l’événement de confirmation (des clients non officiels mentionnent
  `transfer_success`). À défaut, prévoir un reversement **manuel** : l’admin verse lui-même puis
  confirme dans l’appli (le versement est alors tracé dans `audit_log`).

### 4.9 Litiges et remboursements

Table `disputes` (+ historique `dispute_events`) : types `debited_not_recorded`,
`double_payment`, `wrong_amount`, `other` ; statuts `open`, `in_progress`, `resolved`,
`rejected`. Actions du super admin : prendre en charge, enregistrer le paiement manquant,
valider un remboursement (montant + message), rejeter (message). Chaque décision est tracée.

### 4.10 Annonces, SMS et notifications

- `communicationService.announce(target, title, message)` : à tous, à un groupe, aux admins…
  Renvoie le nombre de destinataires. `groupService.announce` pour l’admin d’un groupe.
- `smsStats(days)` : nombre de SMS par type et coût (table `sms_log`, coût unitaire dans les
  paramètres).
- Préférences de notification par utilisateur (`reminders`, `payments`, `beneficiary`) :
  `notification_prefs jsonb` dans `profiles` (déjà prévu dans le cahier d’origine), lues par
  `push-send`.
- Types de notification émis aujourd’hui par la simulation (le champ `type` est libre ; à
  reprendre tels quels pour garder les mêmes écrans) : `added`, `admin`, `admin_compensation`,
  `announcement`, `beneficiary`, `co_admin`, `community`, `cycle_finished`, `dispute`, `draw`,
  `join_accepted`, `join_rejected`, `join_request`, `late`, `new_cycle`, `payment`,
  `payment_failed`, `payout`, `platform_income_ready`, `ready_for_payout`, `reminder`,
  `security`, `swap_accepted`, `swap_approved`, `swap_rejected`, `swap_request`.
  Le lien (`link`) doit être un chemin du frontend.
- **Langue** : le wolof concerne l’**espace des membres** (participants). Enregistrer la langue
  choisie (`profiles.language`, `fr` par défaut ; le choix se fait dans le Profil) et envoyer
  aux membres leurs SMS (rappels, confirmations) et notifications dans cette langue. Le
  back-office (admins, super admin) et les messages qui leur sont destinés restent en français.
  Les modèles de messages (`settings.templates`) doivent donc exister en `fr` et en `wo`.

#### SMS : Orange (API SMS Sénégal)

- Fonction partagée `_shared/orange-sms.ts`, utilisée **uniquement côté serveur** :
  - obtenir un jeton d’accès OAuth auprès d’Orange (identifiants de l’application créée sur le
    portail développeur Orange, API « SMS Senegal ») et le garder en cache jusqu’à expiration ;
  - envoyer le SMS avec le nom d’expéditeur `sms.senderName` (« CALEBASSE », 11 caractères au
    plus) ;
  - noter chaque envoi dans `sms_log` (type, coût `sms.costPerSms`).
- **Vérifier sur le portail développeur Orange** l’adresse du jeton, l’adresse d’envoi et le
  format exact du numéro (indicatif `+221`) : la recherche n’a pas permis de les confirmer.
- Secrets : identifiants Orange dans les secrets Supabase ; la clé affichée dans Paramètres
  n’est qu’un indice (4.11).
- Utilisations : codes de connexion (`auth-otp-send`), rappels et annonces (préférences
  respectées), avec suivi du coût dans « Annonces ».

### 4.11 Paramètres de la plateforme et clés secrètes

- Table `platform_settings` (une ligne) avec les sections `payment`, `rules`, `security`,
  `sms`, `app`, `templates` (type `PlatformSettings`).
- **Clés secrètes en écriture seule** : `settings.get()` ne renvoie jamais la clé secrète
  PayTech (`API_SECRET`) ni la clé Orange, seulement un indice (`secretKeyHint`, `apiKeyHint`, ex. « •••• 3f9a ») ;
  `settings.update(section, values, newSecret?)` ne remplace la clé que si `newSecret` est
  fourni. Stockage : secrets Supabase / Vault, jamais lisibles par le client.
- Les règles (`rules`, `security`) s’appliquent réellement côté serveur (limites, délai de
  grâce, essais du PIN, validité de l’OTP, verrouillage).

### 4.12 Photo de profil

- Bucket `avatars` (cahier d’origine) : lecture publique, écriture limitée à
  `avatars/<user_id>/`.
- Aujourd’hui, `updateProfile({ avatarUrl })` reçoit une **image compressée en data URL**
  (256 px, `src/lib/image.ts`). L’implémentation Supabase doit **téléverser cette image dans le
  bucket** puis enregistrer l’URL publique dans `profiles.avatar_url`. Le contrat ne change
  pas ; `avatarUrl: undefined` retire la photo.
- La photo s’affiche dans le profil, la barre du haut, la liste et la fiche des membres.

### 4.13 Journal d’audit et journal de sécurité

- `audit_log` : toutes les actions de l’énumération `AuditAction` (`src/types/index.ts`, 32
  actions), avec auteur, groupe éventuel et phrase lisible (`summary`). Ajout seul.
- **`security_events`** (nouveau) : `pin_failed`, `pin_blocked`, `otp_failed`,
  `access_denied`, `suspicious_input`, `admin_login`, avec une gravité (`info`, `warning`,
  `critical`), le compte ou le numéro concerné. Lu par `reportService.securityLog()`.
- **Injections** : la vraie protection reste le serveur (requêtes paramétrées, RLS, aucune
  construction de SQL par concaténation, limite de requêtes). La détection
  `suspicious_input` (`src/services/mock/security.ts`) est à reproduire côté serveur pour
  **alimenter le journal** ; elle ne remplace pas ces protections.

### 4.14 Comptes

- Création d’un admin ou d’un membre par le super admin (`createAdmin`, `memberService.create`)
  : si le numéro n’a pas de compte, le compte est créé et devra passer par le SMS puis créer
  son PIN.
- Suppression d’un admin : refusée s’il est encore responsable de groupes (réattribution
  préalable, `reassignGroups`).
- Changement de numéro d’un membre (`changePhone`) : seulement avec le code reçu sur le
  nouveau numéro.
- **Suppression de compte** par l’utilisateur (`deleteAccount`) : refusée s’il participe à une
  tontine en cours ou possède un groupe ; sinon anonymisation (paiements conservés).

### 4.15 Pagination serveur

Ces fonctions renvoient aujourd’hui **toute** la liste ; l’écran en affiche une partie
(« Voir plus », composant `Paged`). Avec de vraies données, elles doivent être paginées **côté
serveur, filtres compris**, et renvoyer les **totaux** affichés en haut de page :

`adminService.listTransactions`, `reportService.auditLog`, `reportService.securityLog`,
`memberService.list`, `adminService.listAdmins`, `groupService.listManaged`,
`disputeService.list`, `financeService.payouts`, `notificationService.list`,
`paymentService.myTransactions`.

Forme proposée (à valider ensemble, car elle modifie légèrement le contrat) :

```ts
interface Page<T, Totals = undefined> {
  items: T[];
  nextCursor: string | null; // null : plus rien à charger
  totals?: Totals;           // ex. montant payé, nombre en attente
}
// ex. listTransactions(query: { status?, method?, groupId?, from?, to?, cursor?, limit? })
```

Côté frontend, il faudra alors remplacer `Paged` / `useShowMore` par `useInfiniteQuery` sur
ces écrans (travail frontend estimé faible, à faire au moment du branchement).

### 4.16 Mode hors ligne

Le service worker (`src/sw/sw.ts`) met en cache les réponses `GET /rest/v1/*` et
`/functions/v1/*` (réseau d’abord, 7 jours) ; le cache est effacé à chaque déconnexion
(`src/lib/dataCache.ts`). Les réponses très sensibles peuvent être exclues avec
`Cache-Control: no-store`.

---

## 5. Correspondance services → backend

Lecture : **T** = lecture directe d’une table ou d’une vue protégée par RLS ;
**RPC** = fonction SQL `security definer` ; **EF** = Edge Function. Les noms RPC sont des
propositions. Liste exhaustive des signatures : [`CONTRAT-BACKEND.md`](CONTRAT-BACKEND.md).

| Service | Fonctions | Mise en œuvre |
|---|---|---|
| `authService` | `sendOtp`, `verifyOtp` | EF `auth-otp-send`, `auth-otp-verify` (4.1) ; `verifyOtp` renvoie `isNewAccount`, `firstName`, `hasPin` et garde le jeton de preuve pour l’étape suivante |
| | `loginMethod` | EF `auth-login-method` → `'pin' \| 'otp'` |
| | `setPin`, `loginWithPin`, `changePin` | EF `auth-pin-set`, `auth-pin-login`, `auth-pin-change` (4.1), puis `supabase.auth.setSession` |
| | `completeProfile` | EF `auth-profile-create` (jeton de preuve) |
| | `updateProfile` | RPC + Storage pour la photo (4.12) |
| | `getSession`, `logout` | Supabase Auth (`getSession`, `signOut`) + profil |
| | `deleteAccount` | RPC `delete_my_account` (anonymisation) |
| `groupService` | `listMine`, `listManaged`, `listDiscoverable`, `get` | T / vues (`GroupOverview` est une vue composée : prévoir une vue SQL ou une RPC) |
| | `create`, `update`, `start`, `remove`, `regenerateInviteCode`, `restartCycle` | RPC (`create_group`, `update_group`, `start_cycle`…) |
| | `getByInviteCode`, `requestJoin`, `requestJoinOpen` | RPC |
| | `announce` | RPC + `notify` |
| `membershipService` | `list` | T / vue `group_member_profiles` |
| | `accept`, `reject`, `remove`, `setRole`, `addByPhone` | RPC |
| `roundService` | `list` | T / vue |
| | `drawOrder`, `setManualOrder` | RPC (tirage côté serveur, tracé) |
| | `payout` | EF `payouts-create` |
| `paymentService` | `listForRound`, `listMine`, `myTransactions`, `getReceipt` | T / vues (statut seul pour les membres si `member_status_visibility = 'admins'`) |
| | `initiatePayment` | EF `payments-initiate` (PayTech, frais compris, 4.7) |
| | `recordCash`, `remindLate`, `remindMember` | RPC |
| `swapService` | `list`, `request`, `respond`, `decide`, `cancel` | T + RPC |
| `notificationService` | `list`, `markRead`, `markAllRead` | T + RPC |
| | `savePushSubscription` | T `push_subscriptions` |
| | `getPreferences`, `updatePreferences` | `profiles.notification_prefs` |
| `memberService` | `list`, `get` | RPC (super admin, paginée) |
| | `create`, `block`, `unblock`, `changePhone` | RPC / EF (`changePhone` vérifie un code SMS envoyé au nouveau numéro) |
| | `resetPin` | EF `admin-pin-reset` (révoque les sessions, 4.1) |
| `adminService` | `dashboard`, `superDashboard` | RPC `admin_stats`, `platform_stats` (étendues) |
| | `listTransactions` | RPC paginée |
| | admins : `listAdmins`, `listAdminChoices`, `getAdmin`, `createAdmin`, `updateAdmin`, `suspend`, `reactivate`, `deleteAdmin`, `reassignGroups` | RPC |
| | communautés : `listCommunities`, `saveCommunity` | T + RPC |
| | supervision : `suspendGroup`, `reactivateGroup`, `closeGroup`, `archiveGroup`, `changeGroupAdmin`, `transferGroup` | RPC |
| `financeService` | `reconciliation`, `payouts`, `earnings` | RPC |
| | `compensateAdmin`, `blockPayout`, `unblockPayout` | RPC |
| `disputeService` | `list`, `take`, `recordPayment`, `refund`, `reject` | T + RPC (`refund` peut passer par un transfert PayTech) |
| `communicationService` | `announce`, `smsStats` | RPC + `notify` / SMS Orange (4.10) |
| `reportService` | `report`, `auditLog`, `securityLog` | RPC (paginées pour les journaux) |
| `settingsService` | `get`, `update` | RPC (clés en écriture seule, 4.11) |
| `smsService` | `send` | `_shared/orange-sms.ts`, côté serveur uniquement (jamais appelé par le client en production) |

---

## 6. Données de démonstration (`seed.sql`)

Pour que le frontend bascule de `VITE_USE_MOCKS=true` à `false` sans surprise, le seed reprend
les données de `src/mocks/` :
- comptes : 1 super admin (Aminata Sow), 2 admins (Moussa Diop, Fatou Ndiaye), les
  participants ; **PIN de démonstration `1234`** ;
- communautés Ouakam et AFP ; groupes « Tontine Famille » (code `FAM4K7`), « Collègues du
  bureau » (`BUR92X`), « Amies du quartier » (`AMI3Q8`), etc. ;
- paiements, notifications, litiges, journal d’audit et de sécurité de démonstration.

Les identifiants du frontend (`u-super`, `g-famille`…) deviendront des UUID : ne pas les
écrire en dur dans le code (seuls les tests de la simulation les utilisent).

---

## 7. Plan d’intégration conseillé

Chaque étape se termine par un parcours qui fonctionne **à l’écran** avec
`VITE_USE_MOCKS=false`.

| Étape | Contenu | Validé quand… |
|---|---|---|
| 1 | Schéma (cahier d’origine + section 4), RLS, seed, types générés | `supabase db reset` sans erreur, tests RLS verts |
| 2 | SMS Orange, connexion code SMS + PIN (4.1), profil, photo | On se connecte avec un compte du seed, on crée un compte, on ajoute une photo ; 5 PIN faux bloquent le compte |
| 3 | Groupes, communautés, adhésions, parts | Un admin crée un groupe, un participant le rejoint par code |
| 4 | Ordre, démarrage, tours (parts multiples, période plateforme) | `start_cycle` produit les mêmes tours que la simulation |
| 5 | Paiements PayTech (mode test) avec frais, espèces, pénalités, `cron-daily` | Un paiement passe à « payé » ; le débit inclut les frais ; la cagnotte n’en contient aucun ; un retard crée une pénalité |
| 6 | Versements (transfert PayTech ou manuel), blocage, revenus, rémunérations | Un tour se reverse ; un tour bloqué ne se reverse pas |
| 7 | Back-office : transactions, réconciliation, litiges, annonces, rapports, journaux, paramètres | Les 12 rubriques s’affichent sans erreur |
| 8 | Pagination serveur (4.15) et passage du frontend à `useInfiniteQuery` | Les 10 listes chargent page par page |
| 9 | Push, rappels SMS, langue des membres (wolof) | Une notification arrive sur le téléphone ; un membre en wolof reçoit son rappel en wolof |

**Réutiliser les tests existants comme tests de contrat :** les 113 tests du frontend
(`src/test/`) appellent les services par leur interface. Les faire tourner aussi contre
l’implémentation Supabase (environnement de test) garantit que le comportement est identique.

---

## 8. Critères d’acceptation de l’intégration

- [ ] Avec `VITE_USE_MOCKS=false`, l’exploration automatique des 76 pages (3 rôles, téléphone
      et ordinateur) ne relève aucune erreur.
- [ ] Les tests de contrat passent contre l’implémentation Supabase.
- [ ] Un participant ne lit aucune donnée d’un groupe dont il n’est pas membre ; chaque refus
      apparaît dans le journal de sécurité.
- [ ] Le PIN est vérifié et compté par le serveur ; après 5 erreurs, seul le SMS débloque ;
      aucune session ne peut s’ouvrir sans PIN, même en appelant Supabase directement.
- [ ] Aucune clé secrète (PayTech, Orange, `service_role`, poivres) n’arrive jamais dans le navigateur.
- [ ] Un paiement n’est « payé » que sur notification PayTech vérifiée, au montant exact attendu.
- [ ] Le membre voit les frais avant de payer ; ils ne sont jamais comptés dans la cagnotte.
- [ ] La simulation (`src/services/mock/`) n’est plus incluse dans le build de production.
- [ ] Lighthouse (connexion, mobile) : performance ≥ 90 une fois la simulation retirée.

---

## 9. Points encore à trancher

Les décisions du 5 novembre (en tête de document) règlent le PIN, PayTech, les frais, Orange
et la langue. Restent :

1. **Pagination** : la forme `Page<T>` (4.15) est-elle acceptée ? Elle modifie 10 signatures.
2. **Commission PayTech** : quel pourcentage exact régler dans `payment.feePercent` (selon le
   contrat PayTech, et éventuellement selon le moyen : Wave, Orange Money…) ?
3. **Reversements** : l’API de transfert PayTech est-elle disponible sur le compte ? Sinon,
   reversement manuel confirmé par l’admin (4.8).
4. **Relecture du wolof** : qui valide les textes de `src/i18n/wo.ts` et les modèles de SMS en
   wolof avant de les envoyer aux membres ?
