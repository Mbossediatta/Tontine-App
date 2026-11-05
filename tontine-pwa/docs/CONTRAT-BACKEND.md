# Contrat frontend ↔ backend — Calebasse de l’Espoir

Ce document dit **exactement ce que l’application attend du serveur**. Aujourd’hui, tout
tourne sur une simulation (`src/services/mock/`). Le backend (Supabase) devra fournir les
mêmes fonctions, avec les mêmes règles, pour que les écrans n’aient presque rien à changer.

> Les listes « Services » et « Annexe : règles » sont tirées automatiquement du code
> (interfaces `src/services/*.service.ts` et messages d’erreur des services simulés).
> En cas de doute, le code fait foi.

## 1. Comment brancher le backend

- **Un seul endroit à changer :** `src/services/index.ts`. Chaque service y est une
  interface (`AuthService`, `GroupService`…) ; on remplace l’implémentation simulée par une
  implémentation Supabase, choisie selon `VITE_USE_MOCKS`.
- **Variables d’environnement** (`.env.example`) : `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`, `VITE_USE_MOCKS`.
  Seule la clé **publique** (anon) va dans le navigateur ; jamais la clé `service_role`.
- **Erreurs :** toute erreur doit arriver aux écrans sous forme de `ServiceError`
  (`src/lib/errors.ts`) avec un message en français prêt à afficher et un code :

  | Code | Quand |
  |---|---|
  | `offline` | pas de réseau |
  | `unauthenticated` | session absente ou expirée |
  | `forbidden` | droits insuffisants, compte ou PIN bloqué |
  | `not_found` | élément introuvable |
  | `invalid` | saisie refusée (valeur hors limites, texte suspect…) |
  | `conflict` | action impossible dans l’état actuel (déjà fait, engagements en cours…) |

  Les erreurs Supabase / Postgres doivent être traduites vers ces codes dans la couche
  service (jamais un message technique à l’écran).
- **Formats :** dates en ISO 8601 (UTC) ; montants en **FCFA, entiers** ; numéros de
  téléphone à 9 chiffres sans indicatif (`772345678`), affichés « +221 77 234 56 78 ».
- **Noms des champs :** l’application utilise le camelCase (`firstName`). Si la base est en
  snake_case (`first_name`), la conversion se fait dans la couche service. Les types de
  référence sont dans `src/types/`.

## 2. Règles transversales à reproduire côté serveur

### Connexion (numéro → code SMS → PIN)
- Code SMS de 6 chiffres **aléatoire**, à usage unique, valable `security.otpValidityMinutes`
  (10 min par défaut). Envoyé par le serveur, jamais renvoyé au navigateur.
- PIN de 4 chiffres, stocké en **empreinte lente** (Argon2 ou bcrypt), jamais en clair.
  Les PIN trop simples (`0000`, `1234`…) sont refusés.
- Après `security.maxPinAttempts` erreurs (5), le PIN est **bloqué** : seul un nouveau code
  SMS permet d’en créer un autre. Le super admin peut forcer la réinitialisation.
- `loginMethod(phone)` répond seulement `'pin'` ou `'otp'` : **jamais** le prénom ni
  aucune autre donnée (sinon on peut découvrir le nom d’une personne avec son numéro).
- Sur ordinateur, l’application ne retient aucun compte (choix produit) ; sur téléphone,
  elle retient numéro + prénom localement. Côté serveur : rien de particulier, mais la
  limite d’essais du PIN doit être appliquée **par le serveur**, pas seulement à l’écran.

### Rôles et droits
- Rôle global : `super_admin`, `admin`, `user`. Rôle dans un groupe : `owner`, `co_admin`,
  `member`.
- **Admin de communauté ≠ admin de groupe** : chaque groupe a son `adminId`, qui peut être
  n’importe quel admin actif. Être admin d’une communauté ne donne aucun droit sur ses
  groupes. Un admin ne crée des groupes que dans ses communautés ; il peut confier le
  groupe à un autre admin (il n’y a alors plus accès).
- Les droits sont vérifiés **à chaque requête** (Row Level Security de Supabase).
  Chaque refus est enregistré dans le journal de sécurité (`access_denied`).

### Clés secrètes (paiement, SMS)
- `settings.get()` ne renvoie **jamais** les clés : seulement un indice
  (`secretKeyHint`, `apiKeyHint`, ex. « •••• 3f9a »).
- `settings.update(section, values, newSecret?)` : `newSecret` remplace la clé seulement
  s’il est fourni. L’ancienne clé n’est jamais relue. Stockage côté serveur (coffre ou
  table protégée), jamais exposé au navigateur.

### Paiement (PayTech)
Détail du parcours PayTech : `CAHIER-DES-CHARGES-INTEGRATION.md`, section 4.7.
1. `initiatePayment({ roundId, method })` crée le paiement « en attente » et renvoie
   `{ paymentId, checkoutUrl }`.
2. Le navigateur est redirigé vers `checkoutUrl`, puis revient sur
   `/paiement/succes?payment=<id>` ou `/paiement/echec?payment=<id>`.
3. **Seule la notification du prestataire (webhook, signature vérifiée) passe le paiement
   à « payé »**. Le retour du navigateur ne prouve rien.
4. L’écran de succès interroge le statut toutes les 3 s (60 s au plus).
5. **Frais payés par le membre** : `serviceFeeAmount` = arrondi supérieur de
   `amount × payment.feePercent / 100`, débité en plus de `amount` et jamais compté
   dans la cagnotte (`myServiceFee` dans la vue du groupe).

### Journal d’audit et journal de sécurité
- Audit : chaque action sensible (création/modification de groupe, versement validé,
  espèces enregistrées, gestion des admins, paramètres, connexion d’un admin…) avec
  auteur, date et phrase lisible. Liste des actions : type `AuditAction` (`src/types`).
- Sécurité (`reportService.securityLog`) : `pin_failed`, `pin_blocked`, `otp_failed`,
  `access_denied`, `suspicious_input`, `admin_login`, avec une gravité
  (`info` / `warning` / `critical`).
- **Injections :** la vraie protection est le serveur — requêtes paramétrées (jamais de SQL
  construit avec du texte saisi), RLS, limite du nombre de requêtes. La détection
  `suspicious_input` de l’application (`src/services/mock/security.ts`) est un signal à
  reproduire côté serveur pour alimenter le journal, pas une protection.

### Pagination (à faire avec le backend)
Ces fonctions renvoient aujourd’hui **toute** la liste ; l’écran n’en affiche qu’une
partie (« Voir plus », composant `Paged`). Avec de vraies données, elles doivent accepter
une page (curseur + taille) **et les filtres de l’écran**, et renvoyer les totaux affichés
en haut de page (sinon les compteurs seraient faux) :

`listTransactions`, `auditLog`, `securityLog`, `memberService.list`, `listAdmins`,
`groupService.listManaged`, `disputeService.list`, `financeService.payouts`,
`notificationService.list`, `paymentService.myTransactions`.

### Hors ligne
Le service worker (`src/sw/sw.ts`) met en cache les réponses `GET /rest/v1/*` et
`/functions/v1/*` (réseau d’abord, 7 jours). Ce cache est **effacé à chaque déconnexion**
(`src/lib/dataCache.ts`). Les réponses très sensibles peuvent être exclues avec
`Cache-Control: no-store`.

### Langue
Les messages d’erreur et notifications sont aujourd’hui en français. L’application sait
afficher le wolof (`src/i18n`) : prévoir un paramètre de langue pour les SMS et
notifications envoyés par le serveur.

## 3. À retirer en production (mode démonstration)
Visibles seulement si `VITE_USE_MOCKS=true`, et chargés à la demande :
choix des comptes de démo (`DemoAccountPicker`), PIN de démo (`src/lib/demo.ts`), page
`/paiement/simulation`, bouton « Démo : simuler la date limite dépassée », page `/demo-ui`,
SMS affichés dans la console. Les services simulés (`src/services/mock/`) disparaîtront du
build quand `src/services/index.ts` choisira les services Supabase.

## 4. Services attendus

### `adminService`

- `dashboard() → AdminDashboard`
- `superDashboard() → SuperAdminDashboard`
- `listTransactions() → TransactionRow[]`
- `listAdmins() → AdminPerformance[]`
- `listAdminChoices() → AdminChoice[]`
- `getAdmin(userId: string) → AdminPerformance`
- `createAdmin(input: AccountInput) → void`
- `updateAdmin(userId: string, input: AccountInput) → void`
- `suspend(userId: string) → void`
- `reactivate(userId: string) → void`
- `deleteAdmin(userId: string) → void`
- `reassignGroups(fromId: string, toId: string) → number`
- `listCommunities() → Community[]`
- `saveCommunity(input: SaveCommunityInput) → Community`
- `suspendGroup(groupId: string) → void`
- `reactivateGroup(groupId: string) → void`
- `closeGroup(groupId: string) → void`
- `archiveGroup(groupId: string) → void`
- `changeGroupAdmin(groupId: string, adminId: string) → void`
- `transferGroup(groupId: string, communityId: string, adminId: string) → void`

### `authService`

- `getSession() → SessionState`
- `loginMethod(phone: string) → 'pin' | 'otp'`
- `sendOtp(phone: string) → void`
- `verifyOtp(phone: string, code: string) → OtpResult`
- `completeProfile(input: CompleteProfileInput) → void`
- `setPin(pin: string) → User`
- `loginWithPin(phone: string, pin: string) → User`
- `changePin(currentPin: string, newPin: string) → void`
- `updateProfile(input: UpdateProfileInput) → User`
- `logout() → void`
- `deleteAccount() → void`

### `communicationService`

- `announce(target: AnnouncementTarget, title: string, message: string) → number`
- `smsStats(days: number) → SmsStats`

### `disputeService`

- `list() → DisputeView[]`
- `take(disputeId: string) → void`
- `recordPayment(disputeId: string) → void`
- `refund(disputeId: string, amount: number, note: string) → void`
- `reject(disputeId: string, note: string) → void`

### `financeService`

- `reconciliation(month: string) → Reconciliation`
- `payouts() → PayoutRow[]`
- `earnings() → PlatformEarningsView`
- `compensateAdmin(groupId: string, amount: number, note: string) → void`
- `blockPayout(roundId: string, reason: string) → void`
- `unblockPayout(roundId: string) → void`

### `groupService`

- `listMine() → GroupOverview[]`
- `listDiscoverable() → GroupOverview[]`
- `listManaged() → GroupOverview[]`
- `get(groupId: string) → GroupOverview`
- `create(input: CreateGroupInput) → Group`
- `update(groupId: string, input: UpdateGroupInput) → Group`
- `start(groupId: string) → Group`
- `remove(groupId: string) → void`
- `regenerateInviteCode(groupId: string) → string`
- `restartCycle(groupId: string, input: RestartCycleInput) → Group`
- `getByInviteCode(code: string) → JoinPreview`
- `requestJoin(code: string) → void`
- `requestJoinOpen(groupId: string) → void`
- `announce(groupId: string, message: string) → number`

### `memberService`

- `list(query?: string) → MemberSummary[]`
- `get(userId: string) → MemberProfile`
- `create(input: AccountInput) → string`
- `block(userId: string) → void`
- `unblock(userId: string) → void`
- `resetPin(userId: string) → void`
- `changePhone(userId: string, newPhone: string, code: string) → void`

### `membershipService`

- `list(groupId: string) → MemberView[]`
- `accept(membershipId: string) → void`
- `reject(membershipId: string) → void`
- `remove(membershipId: string) → void`
- `setRole(membershipId: string, role: 'co_admin' | 'member') → void`
- `addByPhone(groupId: string, phone: string, shareCount?: number) → number`

### `notificationService`

- `list() → AppNotification[]`
- `markRead(notificationId: string) → void`
- `markAllRead() → void`
- `savePushSubscription(subscription: PushSubscriptionJSON) → void`
- `getPreferences() → NotificationPreferences`
- `updatePreferences(preferences: NotificationPreferences) → NotificationPreferences`

### `paymentService`

- `listForRound(roundId: string) → RoundPaymentRow[]`
- `listMine(groupId: string) → MyGroupHistory`
- `myTransactions() → MyTransaction[]`
- `initiatePayment(input: InitiatePaymentInput) → InitiatePaymentResult`
- `getReceipt(paymentId: string) → PaymentReceipt`
- `recordCash(roundId: string, userId: string) → void`
- `remindLate(roundId: string) → number`
- `remindMember(roundId: string, userId: string) → void`

### `reportService`

- `report(from: string, to: string) → PlatformReport`
- `auditLog() → AuditView[]`
- `securityLog() → SecurityEventView[]`

### `roundService`

- `list(groupId: string) → RoundView[]`
- `drawOrder(groupId: string) → MemberView[]`
- `setManualOrder(groupId: string, membershipIds: string[]) → void`
- `payout(roundId: string) → void`

### `settingsService`

- `get() → PlatformSettings`
- `update(section, values, newSecret?) → void`

### `smsService`

- `send(phone: string, message: string) → void`

### `swapService`

- `list(groupId: string) → SwapView[]`
- `request(groupId: string, partnerRoundId: string) → void`
- `respond(swapId: string, accept: boolean) → void`
- `decide(swapId: string, approve: boolean) → void`
- `cancel(swapId: string) → void`

## Annexe : règles appliquées par la simulation (137)

Chaque ligne est un refus que le serveur doit reproduire (message affiché tel quel, et code entre parenthèses quand ce n’est pas `invalid`). Regroupées par fichier de la simulation.

### access.ts (5)
- Ce groupe n’existe pas. (not_found)
- Ce tour n’existe pas. (not_found)
- Ce membre n’existe pas. (not_found)
- Seul le propriétaire du groupe peut faire cela. (forbidden)
- Réservé aux administrateurs. (forbidden)
### admin.mock.ts (19)
- Ce compte n’est pas administrateur. (forbidden)
- Numéro de téléphone invalide.
- Ce numéro est déjà utilisé par un autre compte. (conflict)
- Cette personne est déjà administrateur. (conflict)
- Réattribuez d’abord ses ${plural(responsible.length, 'groupe')} à un autre administrateur. (conflict)
- Choisissez un autre administrateur.
- Cet administrateur est suspendu.
- Le nom doit contenir entre 2 et 60 caractères.
- La description ne peut pas dépasser 300 caractères.
- Affectez au moins un administrateur à cette communauté.
- Une communauté ne peut être confiée qu’à des admins actifs.
- Une communauté porte déjà ce nom. (conflict)
- Cette communauté est introuvable. (not_found)
- Ce groupe est déjà suspendu.
- Ce groupe est déjà clôturé.
- Ce groupe n’est pas suspendu.
- Seul un groupe terminé ou clôturé peut être archivé.
- Choisissez une communauté existante.
- Choisissez un administrateur actif.
### auth.mock.ts (9)
- Ce compte est bloqué. Contactez un administrateur. (forbidden)
- Le compte du super administrateur ne peut pas être supprimé. (forbidden)
- Vous participez à une tontine en cours (« ${groupOf(ongoing.groupId)?.name ?? ''} »). Vous pourrez supprimer votre compte à la fin du cycle. (conflict)
- Vous êtes propriétaire du groupe « ${groupOf(owned.groupId)?.name ?? ''} ». Supprimez-le d’abord. (conflict)
- Session expirée, recommencez la connexion. (unauthenticated)
- Un compte existe déjà avec ce numéro. (conflict)
- Aucun compte avec ce numéro. (not_found)
- Choisissez un code différent de l’actuel.
- Compte de démonstration introuvable.
### clock.ts (1)
- Ce tour n’est plus ouvert.
### communication.mock.ts (2)
- Le titre et le message de l’annonce sont obligatoires.
- La période doit être comprise entre 1 et 365 jours.
### db.ts (4)
- Connexion requise pour cette action. (offline)
- Utilisateur introuvable. (not_found)
- Veuillez vous reconnecter. (unauthenticated)
- Votre compte est suspendu. (forbidden)
### dispute.mock.ts (9)
- Ce litige est introuvable. (not_found)
- Ce litige est déjà clôturé.
- Ce litige est déjà pris en charge.
- Cette action concerne un paiement débité mais non enregistré.
- Ce paiement est absent du relevé du service de paiement.
- Ce membre est déjà enregistré comme ayant payé ce tour.
- Montant invalide.
- Le remboursement ne peut pas dépasser ${formatAmount(dispute.amount)}.
- Expliquez au membre pourquoi la réclamation est rejetée.
### finance.mock.ts (6)
- Le montant doit être un nombre entier supérieur à zéro.
- Le montant dépasse les revenus disponibles du groupe (${balance} FCFA).
- Indiquez le motif de cette rémunération.
- Cette cagnotte a déjà été versée.
- Indiquez la raison du blocage.
- Ce versement n’est pas bloqué.
### gateway.ts (1)
- Paiement introuvable. (not_found)
### group.mock.ts (26)
- Code d’invitation inconnu. (not_found)
- Choisissez l’administrateur responsable du groupe.
- La cotisation doit être comprise entre ${formatAmount(minContribution)} et ${formatAmount(maxContribution)}.
- Un groupe ne peut pas dépasser ${maxMembers} parts.
- Les parts payées par tour ne peuvent pas dépasser les parts du groupe.
- Affectez d’abord votre compte à une communauté.
- Vous n’êtes pas administrateur de cette communauté.
- Les règles financières et le nombre total de parts sont verrouillés après le démarrage.
- Le groupe compte déjà plus de parts que ce nombre.
- Le cycle a déjà démarré.
- Un groupe doit avoir au moins deux personnes distinctes.
- Toutes les parts doivent être attribuées avant de démarrer le groupe.
- Fixez d’abord l’ordre des bénéficiaires.
- La date de démarrage est passée : choisissez-en une nouvelle dans les réglages.
- Seul un groupe en brouillon peut être supprimé.
- Ce groupe a un historique de paiements : il ne peut pas être supprimé.
- Seul un groupe terminé peut repartir pour un nouveau cycle.
- Date de démarrage invalide.
- Vous avez déjà rejoint ce groupe.
- Ce groupe a déjà démarré.
- Toutes les parts configurées pour ce groupe sont attribuées.
- La découverte est réservée aux participants.
- Ce groupe est privé : utilisez son code d’invitation.
- Ce groupe est réservé aux membres de sa communauté. (forbidden)
- Ce groupe a déjà démarré et n’accepte plus de membres.
- Écrivez un message avant d’envoyer.
### member.mock.ts (6)
- Le compte du super administrateur ne se gère pas ici. (forbidden)
- Ce compte a été supprimé. (not_found)
- Numéro de téléphone invalide.
- Un compte existe déjà avec ce numéro. (conflict)
- C’est déjà son numéro actuel.
- Ce numéro est déjà utilisé par un autre compte. (conflict)
### membership.mock.ts (9)
- Toutes les parts configurées pour ce groupe sont attribuées.
- Demande déjà traitée.
- Impossible de retirer un membre après le démarrage du cycle.
- Le propriétaire ne peut pas être retiré.
- Le rôle du propriétaire est fixe.
- Ce membre n’est pas actif.
- Le cycle a déjà démarré.
- Le nombre de parts doit être compris entre 1 et la capacité du groupe.
- Aucun compte avec ce numéro. Partagez le lien d’invitation pour qu’il s’inscrive. (not_found)
### otp.ts (4)
- Aucun code en cours pour ce numéro. Demandez-en un nouveau.
- Ce code a expiré. Demandez-en un nouveau.
- Trop d’essais. Demandez un nouveau code.
- Code incorrect. Vérifiez le SMS reçu et réessayez.
### payment.mock.ts (6)
- Vous ne faites pas partie de ce groupe. (forbidden)
- Ce tour n’accepte plus de paiement.
- Vous avez déjà payé ce tour. (conflict)
- Paiement introuvable. (not_found)
- Ce membre a déjà payé.
- Ce membre ne fait pas partie de ce groupe. (forbidden)
### pin.ts (5)
- Créez d’abord votre PIN : recevez un code par SMS. (conflict)
- PIN bloqué après ${maxAttempts()} essais. Recevez un code par SMS pour en créer un nouveau. (forbidden)
- PIN incorrect. Il vous reste ${left} essai${left > 1 ? 's' : ''}.
- Le PIN doit contenir 4 chiffres.
- Ce PIN est trop facile à deviner. Choisissez-en un autre.
### platform.ts (2)
- Ce groupe est suspendu par l’administration de la plateforme.
- Ce groupe est clôturé.
### report.mock.ts (2)
- Période de rapport invalide.
- La date de début doit précéder la date de fin.
### round.mock.ts (6)
- L’ordre ne peut plus être modifié après le démarrage.
- L’ordre doit contenir chaque membre une seule fois.
- Versement bloqué par l’administration de la plateforme : ${round.payoutBlockReason ?? 'vérification en cours'}.
- Cette cagnotte a déjà été reversée.
- Tous les membres doivent avoir payé avant le reversement.
- Un bénéficiaire n’a pas renseigné de numéro de reversement.
### security.ts (1)
- Ce texte contient des caractères non autorisés. (invalid)
### settings.mock.ts (3)
- Les paramètres transmis sont invalides.
- Cette section n’a pas de clé secrète.
- Cette clé paraît trop courte.
### swap.mock.ts (11)
- Cette demande d’échange n’existe plus. (not_found)
- Cette demande est déjà traitée.
- Seuls des tours à venir peuvent être échangés.
- Le cycle doit être en cours.
- Vous ne faites pas partie de ce groupe. (forbidden)
- Vous n’avez pas de tour dans ce cycle.
- Choisissez le tour d’un autre membre.
- Une demande d’échange est déjà en cours pour l’un de ces tours.
- Cette demande ne vous est pas adressée. (forbidden)
- L’autre membre doit d’abord accepter.
- Seul l’auteur de la demande peut l’annuler. (forbidden)
