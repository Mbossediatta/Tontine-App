// Vues composées renvoyées par les services (données prêtes à afficher).
import type {
  DisputeKind,
  Debt,
  AttributionMode,
  AuditAction,
  AuditEntry,
  SecurityEvent,
  SecurityEventKind,
  SecuritySeverity,
  AdminCompensation,
  Dispute,
  DisputeEvent,
  Community,
  ProviderEntry,
  SmsKind,
  SmsRecord,
  Frequency,
  Group,
  GroupRole,
  Membership,
  MembershipStatus,
  Payment,
  PaymentMethod,
  PaymentStatus,
  PayoutMethod,
  Round,
  SwapRequest,
  User,
  PlatformEarning,
} from './index';

/** Utilisateur vu par un tiers : le téléphone n'est fourni qu'aux administrateurs du groupe. */
export interface PublicUser {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  phone?: string;
  payoutPhone?: string;
  payoutMethod?: PayoutMethod;
}

export interface GroupOverview {
  group: Group;
  communityName?: string;
  /** Nom de l'administrateur responsable du groupe. */
  adminName: string;
  /** Je peux gérer ce groupe (admin responsable, propriétaire, co-admin ou super admin). */
  canManage: boolean;
  myRole?: GroupRole;
  myMembershipStatus?: MembershipStatus;
  /** Nombre de personnes distinctes inscrites au groupe. */
  activeMemberCount: number;
  /** Nombre total de parts actives, qui détermine les tours et la cagnotte. */
  activeShareCount: number;
  pendingRequestCount: number;
  potAmount: number;
  totalRounds: number;
  currentRound?: Round;
  currentBeneficiary?: PublicUser;
  currentBeneficiaries: PublicUser[];
  paidCount: number;
  totalCollected: number;
  /** Mon statut de paiement pour le tour en cours. */
  myStatus?: PaymentStatus;
  /** Montant dû pour toutes mes parts du tour en cours, pénalité éventuelle incluse. */
  myAmountDue: number;
  /** Frais d'adhésion restant à payer, une seule fois par personne. */
  myMembershipFeeDue: number;
  /** Pénalité de retard appliquée sur le tour en cours. */
  myPenalty: number;
  /** Frais de paiement (PayTech) à ajouter à myAmountDue, payés par le membre. */
  myServiceFee: number;
  /**
   * Cotisation d'une période du rythme (jour, semaine…) pour toutes mes parts : unité d'un
   * versement quand je paie mon tour en plusieurs fois.
   */
  myPeriodAmount: number;
  /** Pourcentage des frais de paiement (Paramètres), pour chiffrer un versement. */
  feePercent: number;
  /** Mon tour de bénéficiaire, s'il n'est pas encore reversé. */
  myTurn?: Round;
  orderIsSet: boolean;
}

export interface CommunityOverview extends Community {
  admins: PublicUser[];
  groupCount: number;
  activeGroupCount: number;
}

export interface MemberView {
  membership: Membership;
  user: PublicUser;
  shareNumber: number;
  shareCount: number;
  currentStatus?: PaymentStatus;
}

export interface RoundView {
  round: Round;
  beneficiary: PublicUser;
  beneficiaries: PublicUser[];
  beneficiaryShares: Array<{ user: PublicUser; shareCount: number; amount: number }>;
  paidCount: number;
  /** Heure limite du tour (date limite, heure limite du groupe, délai de grâce), ISO. */
  deadline: string;
}

export interface DebtView {
  debt: Debt;
  user: PublicUser;
  roundNumber: number;
}

export interface RoundPaymentRow {
  user: PublicUser;
  status: PaymentStatus;
  payment?: Payment;
  /** Nombre de parts détenues par ce membre dans le groupe. */
  shareCount: number;
  /** Pénalité de retard appliquée à ce membre pour ce tour. */
  penalty: number;
  /** Déjà versé sur le tour (paiement par versements), hors frais d'adhésion. */
  paidAmount: number;
  /** Total du tour pour ce membre : cotisation de ses parts sur tout le tour, plus pénalité. */
  totalAmount: number;
}

export interface PaymentHistoryItem {
  payment: Payment;
  roundNumber: number;
  cycle: number;
}

/**
 * Une ligne de mon historique, tous groupes confondus : une cotisation que j'ai
 * versée (ou tentée), ou une cagnotte que j'ai reçue.
 */
export type MyTransaction =
  | {
      kind: 'contribution';
      id: string;
      /** Date du paiement, sinon de sa tentative. */
      date: string;
      groupId: string;
      groupName: string;
      roundNumber: number;
      cycle: number;
      payment: Payment;
    }
  | {
      kind: 'payout';
      id: string;
      date: string;
      groupId: string;
      groupName: string;
      roundNumber: number;
      /** Ma part de la cagnotte (un tour peut avoir plusieurs bénéficiaires). */
      amount: number;
    };

export interface MyGroupHistory {
  payments: PaymentHistoryItem[];
  received: Round[];
}

export interface PlatformEarningsView {
  earnings: Array<PlatformEarning & { groupName: string; memberName?: string }>;
  compensations: Array<AdminCompensation & { groupName: string; adminName: string }>;
  earnedTotal: number;
  compensatedTotal: number;
  available: number;
}

export interface PaymentReceipt {
  payment: Payment;
  groupId: string;
  groupName: string;
  roundNumber: number;
  cycle: number;
}

export interface JoinPreview {
  group: Group;
  communityName?: string;
  activeMemberCount: number;
  activeShareCount: number;
  placesLeft: number;
  adminNames: string[];
  myMembershipStatus?: MembershipStatus;
}

export interface CreateGroupInput {
  communityId?: string;
  joinPolicy?: 'invite' | 'community';
  name: string;
  description?: string;
  contributionAmount: number;
  turnLength: number;
  sharesPerRound?: number;
  membershipFeeAmount?: number;
  collectMembershipFee?: boolean;
  reserveFinalTurn?: boolean;
  frequency: Frequency;
  maxMembers: number;
  paymentDueDay: number;
  /** Heure limite (« HH:MM », heure de Dakar) ; par défaut 23:59. */
  paymentDueTime?: string;
  startDate: string;
  attributionMode: AttributionMode;
  latePenalty?: number;
  /** Super administrateur : l'administrateur à qui il confie le groupe. */
  adminId?: string;
}

export type UpdateGroupInput = Partial<Omit<CreateGroupInput, 'communityId' | 'adminId'>>;

export interface SaveCommunityInput {
  id?: string;
  name: string;
  description?: string;
  adminIds: string[];
}

export interface RestartCycleInput {
  startDate: string;
  /** Garder l'ordre des bénéficiaires du cycle précédent, ou le refaire. */
  keepOrder: boolean;
}

export interface SwapView {
  request: SwapRequest;
  requester: PublicUser;
  partner: PublicUser;
  requesterRound: Round;
  partnerRound: Round;
}

export interface InitiatePaymentInput {
  roundId: string;
  method: Exclude<PaymentMethod, 'cash'>;
  /** Versement de quelques jours (ou périodes) du tour ; absent : tout le reste du tour. */
  periods?: number;
}

export interface InitiatePaymentResult {
  paymentId: string;
  checkoutUrl: string;
}

export interface NotificationPreferences {
  reminders: boolean;
  beneficiary: boolean;
  payments: boolean;
}

export type TodoKind = 'join_request' | 'ready_for_payout' | 'failed_payment' | 'swap_request';

export interface TodoItem {
  id: string;
  kind: TodoKind;
  groupId: string;
  groupName: string;
  label: string;
}

/** Prochain versement prévu parmi les groupes d'un administrateur. */
export interface NextPayout {
  /** Date limite du tour : le versement suit le paiement de tous les membres. */
  date: string;
  groupId: string;
  groupName: string;
  beneficiaryName: string;
}

/** Tableau de bord d'un administrateur : uniquement les groupes qu'il gère. */
export interface AdminDashboard {
  activeGroups: number;
  /** Personnes actives de ses groupes en cours (une personne dans deux groupes compte deux fois). */
  memberCount: number;
  /** Encaissé sur les tours dont l'échéance tombe ce mois-ci… */
  collectedThisMonth: number;
  /** … sur ce qui y était attendu (cotisations + pénalités). */
  expectedThisMonth: number;
  /** Membres en retard sur le tour en cours de chaque groupe. */
  lateMembers: number;
  /** Somme due par ces membres en retard (cotisation + pénalité). */
  lateAmount: number;
  nextPayout?: NextPayout;
  todo: TodoItem[];
  groups: GroupOverview[];
}

/** Attendu et collecté sur les tours dont l'échéance tombe dans un mois donné. */
export interface MonthlyCollection {
  /** Premier jour du mois, au format ISO. */
  month: string;
  expected: number; // FCFA
  collected: number; // FCFA
}

/** Ton d'une alerte : rouge (échec), orange (retard), bleu (information). */
export type AlertTone = 'danger' | 'warning' | 'info';

/** Alerte affichée au super administrateur dans « Alertes à traiter ». */
export interface PlatformAlert {
  id: string;
  tone: AlertTone;
  title: string;
  detail: string;
  /** Page où traiter l'alerte, si elle existe. */
  link?: string;
}

/** Performance d'un administrateur : ses groupes et leur taux de recouvrement. */
export interface AdminPerformance {
  user: User;
  groups: Array<Pick<Group, 'id' | 'name' | 'status'>>;
  /** Membres actifs de ses groupes (hors lui-même). */
  memberCount: number;
  /** Collecté ÷ attendu sur les tours échus de ses groupes, en %. `null` si aucun tour échu. */
  recoveryRate: number | null;
  /** Le PIN est à (re)créer à sa prochaine connexion (compte neuf ou réinitialisé). */
  pinPending: boolean;
}

/** Une transaction (paiement) avec le contexte nécessaire pour l'afficher ou l'exporter. */
export interface TransactionRow {
  payment: Payment;
  user: PublicUser;
  groupId: string;
  groupName: string;
  roundNumber: number;
}

/** Entrée du journal d'audit avec le nom de son auteur. */
export interface AuditView {
  entry: AuditEntry;
  actorName: string;
}

/** Événement de sécurité avec le nom du compte concerné, s'il existe. */
export interface SecurityEventView {
  event: SecurityEvent;
  userName?: string;
}

/** Tableau de bord du super administrateur : toute la plateforme. */
export interface SuperAdminDashboard {
  groups: { total: number; active: number; suspended: number; finished: number; draft: number };
  /** Participants inscrits (comptes « user » non supprimés). */
  members: number;
  newMembersThisMonth: number;
  collectedThisMonth: number;
  expectedThisMonth: number;
  /**
   * Part des cotisations échues payées au plus tard à leur date limite, en %.
   * `null` tant qu'aucune cotisation n'est arrivée à échéance.
   */
  onTimeRate: number | null;
  /** Somme restant due par les membres en retard (cotisation + pénalité). */
  lateAmount: number;
  /** Membres en retard sur le tour en cours de leurs groupes. */
  lateMembers: number;
  /** Pénalités posées ce mois-ci (montant et nombre). */
  penaltiesThisMonth: number;
  penaltyCountThisMonth: number;
  /** Impayés devenus dettes, pas encore remboursés. */
  openDebts: number;
  openDebtAmount: number;
  /** Cagnottes validées dont l'argent reste à envoyer, ou dont la réception n'est pas confirmée. */
  transfersToSend: number;
  transfersAwaiting: number;
  /** Réclamations ouvertes ou en cours. */
  openDisputes: number;
  /** Les 6 derniers mois, du plus ancien au mois en cours. */
  monthly: MonthlyCollection[];
  alerts: PlatformAlert[];
  admins: AdminPerformance[];
  /** Les 5 transactions les plus récentes. */
  transactions: TransactionRow[];
  /** Les 5 dernières entrées du journal d'audit. */
  audit: AuditView[];
}

/** Admin actif proposé comme administrateur d'un groupe. */
export interface AdminChoice {
  id: string;
  name: string;
}

export interface AdminAccount {
  user: User;
  groupCount: number;
}

/** Étape d'un versement, vue par le super administrateur. */
export type PayoutStage = 'upcoming' | 'collecting' | 'ready' | 'approval' | 'blocked' | 'paid';

/** Ligne de la rubrique « Versements ». */
export interface PayoutRow {
  round: Round;
  groupId: string;
  groupName: string;
  adminName: string;
  beneficiary: PublicUser;
  beneficiaries: PublicUser[];
  stage: PayoutStage;
  collected: number;
  expected: number;
  /** Nom de l'administrateur qui a validé le versement. */
  validatedByName?: string;
}

/** Réconciliation d'un mois : attendu, relevé du service de paiement, enregistré dans l'appli. */
export interface Reconciliation {
  month: string;
  /** Cotisations attendues sur les tours échus ce mois-ci. */
  expected: number;
  /** Paiements en ligne réussis enregistrés dans l'application. */
  recordedOnline: number;
  /** Espèces enregistrées par les admins (n'apparaissent pas chez le service de paiement). */
  recordedCash: number;
  /** Total du relevé du service de paiement. */
  provider: number;
  /** Encaissé par le service de paiement mais absent de l'application. */
  providerOnly: Array<ProviderEntry & { userName?: string }>;
  /** Payé en ligne dans l'application mais absent du relevé. */
  appOnly: TransactionRow[];
  /** Paiements présents des deux côtés. */
  matched: number;
}

/** Litige avec le contexte nécessaire à son traitement. */
/** Réclamation ouverte par un membre depuis l'application. */
export interface OpenDisputeInput {
  groupId: string;
  roundId?: string;
  kind: DisputeKind;
  /** Montant en jeu (FCFA). */
  amount: number;
  method?: PaymentMethod;
  /** Référence de la transaction (Wave, Orange Money), si le membre l'a. */
  providerRef?: string;
  description: string;
}

/** Une de mes réclamations et son suivi. */
export interface MyDispute {
  dispute: Dispute;
  groupName: string;
  roundNumber?: number;
  history: DisputeEvent[];
}

export interface DisputeView {
  dispute: Dispute;
  user: PublicUser;
  groupName: string;
  payment?: Payment;
  history: Array<DisputeEvent & { actorName: string }>;
}

/** Ligne d'un rapport (un groupe ou un administrateur) sur la période choisie. */
export interface ReportRow {
  id: string;
  label: string;
  sublabel?: string;
  expected: number;
  collected: number;
  /** Collecté ÷ attendu en %, `null` si rien n'était attendu. */
  rate: number | null;
  lateAmount: number;
  paidOut: number;
}

/** Rapport de la plateforme sur une période. */
export interface PlatformReport {
  from: string;
  to: string;
  totals: Omit<ReportRow, 'id' | 'label' | 'sublabel'> & { newMembers: number; members: number };
  monthly: MonthlyCollection[];
  /** Membres inscrits à la fin de chaque mois, et nouveaux du mois. */
  members: Array<{ month: string; total: number; added: number }>;
  byGroup: ReportRow[];
  byAdmin: ReportRow[];
}

/** Suivi des SMS d'une période : volume et coût, au total et par motif. */
/** Notifications envoyées dans l'application (et en push), par type, sur une période. */
export interface NotificationStats {
  count: number;
  byType: Array<{ type: string; count: number }>;
}

export interface SmsStats {
  count: number;
  cost: number;
  byKind: Array<{ kind: SmsKind; count: number; cost: number }>;
  recent: Array<SmsRecord & { name?: string }>;
}

/** Destinataires d'une annonce. */
export type AnnouncementTarget =
  { kind: 'all' } | { kind: 'admins' } | { kind: 'group'; groupId: string };

export interface SessionState {
  user: User | null;
  /** Numéro vérifié par OTP mais profil pas encore complété. */
  needsProfile: boolean;
  /** Connecté, mais doit (re)créer son PIN avant d'utiliser l'application. */
  needsPin: boolean;
  /** Minutes d'inactivité avant que l'application se verrouille (PIN redemandé). */
  lockAfterMinutes: number;
}

/** Identité saisie pour créer un compte (membre ou administrateur) ou modifier un admin. */
export interface AccountInput {
  firstName: string;
  lastName: string;
  phone: string;
}

/** Ligne de la liste des membres de la plateforme. */
export interface MemberSummary {
  user: User;
  /** Groupes où il est membre actif. */
  groupCount: number;
  /** Cotisations actuellement en retard. */
  lateCount: number;
  /** Le PIN est à (re)créer à la prochaine connexion. */
  pinPending: boolean;
}

/** Fiche complète d'un membre (super administrateur). */
export interface MemberProfile {
  summary: MemberSummary;
  groups: Array<{ group: Group; role: GroupRole; status: MembershipStatus; shareCount: number }>;
  /** Ses paiements, du plus récent au plus ancien. */
  payments: TransactionRow[];
  /** Ses cotisations en retard, avec la somme due. */
  lates: Array<{ groupId: string; groupName: string; roundNumber: number; amount: number }>;
  /** Les cagnottes qu'il a reçues. */
  received: Array<{ groupId: string; groupName: string; round: Round }>;
}

/** Conditions d'utilisation et politique de confidentialité en vigueur (lisibles sans session). */
export interface LegalTerms {
  /** Augmente à chaque modification des textes : chacun doit alors les accepter de nouveau. */
  version: number;
  termsText: string;
  privacyText: string;
}

/** Pour la personne connectée : version en vigueur et dernière version acceptée. */
export interface TermsStatus {
  current: number;
  /** null : jamais acceptées. */
  accepted: number | null;
}

export interface CompleteProfileInput {
  firstName: string;
  lastName: string;
  avatarUrl?: string;
}

export interface UpdateProfileInput {
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  payoutPhone?: string;
  payoutMethod?: PayoutMethod;
}

// --- Listes paginées par le serveur (Transactions, Journal d'audit, Sécurité) ---------

/** Position dans une liste triée du plus récent au plus ancien : date et id de la dernière ligne reçue. */
export interface PageCursor {
  at: string;
  id: string;
}

/** Une page d'une longue liste ; `summary` (totaux) n'accompagne que la première page. */
export interface ListPage<Row, Summary> {
  rows: Row[];
  /** Où reprendre pour la page suivante ; absent quand tout a été reçu. */
  next?: PageCursor;
  summary?: Summary;
}

export interface TransactionFilters {
  status?: PaymentStatus;
  method?: PaymentMethod;
  groupId?: string;
  /** Dates « AAAA-MM-JJ », bornes comprises. */
  from?: string;
  to?: string;
}

export interface TransactionSummary {
  total: number;
  paidAmount: number;
  /** En attente ou en échec. */
  openCount: number;
}

export interface AuditFilters {
  search?: string;
  actorId?: string;
  /** Types d'action retenus (une famille, ou un seul type). */
  actions?: AuditAction[];
  from?: string;
  to?: string;
}

export interface AuditSummary {
  total: number;
  /** Auteurs distincts parmi les actions retenues. */
  actors: number;
  /** Actions du jour, tous filtres confondus. */
  today: number;
}

export interface AuditActor {
  id: string;
  name: string;
}

export interface SecurityFilters {
  kinds?: SecurityEventKind[];
  severity?: SecuritySeverity;
  search?: string;
}

export interface SecurityTotals {
  total: number;
}

/** Compteurs de la rubrique Sécurité, indépendants des filtres. */
export interface SecuritySummary {
  lastWeek: Partial<Record<SecurityEventKind, number>>;
  criticalToday: number;
  all: number;
  critical: number;
  login: number;
  access: number;
  input: number;
}
