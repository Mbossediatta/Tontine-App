export type GlobalRole = 'super_admin' | 'admin' | 'user';
export type GroupRole = 'owner' | 'co_admin' | 'member';
/** Rythme de cotisation, choisi par l'admin du groupe. */
export type Frequency = 'daily' | 'weekly' | 'biweekly' | 'monthly';
/** `suspended` : groupe gelé par le super administrateur (plus aucun paiement ni versement). */
export type GroupStatus = 'draft' | 'active' | 'finished' | 'suspended';
export type AttributionMode = 'random' | 'manual';
export type MembershipStatus = 'pending' | 'active' | 'removed';
export type RoundStatus = 'upcoming' | 'open' | 'ready_for_payout' | 'paid_out';
export type PaymentStatus = 'pending' | 'paid' | 'late' | 'failed' | 'refunded';
export type PaymentMethod = 'wave' | 'orange_money' | 'free_money' | 'cash';
export type PayoutMethod = 'wave' | 'orange_money';

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  avatarUrl?: string;
  globalRole: GlobalRole;
  isSuspended: boolean;
  payoutPhone?: string;
  payoutMethod?: PayoutMethod;
  /** Compte supprimé à la demande de l'utilisateur (données anonymisées). */
  deletedAt?: string;
  /** Date d'inscription (ISO). */
  createdAt?: string;
}

export interface Community {
  id: string;
  name: string;
  description?: string;
  /** Un administrateur peut gérer plusieurs communautés. */
  adminIds: string[];
  createdAt: string;
}

export interface Group {
  id: string;
  /** Communauté à laquelle ce groupe est rattaché. */
  communityId?: string;
  /** Groupes ouverts à la découverte par les membres de la communauté. */
  joinPolicy?: 'invite' | 'community';
  name: string;
  description?: string;
  /** Cotisation par part et par période du rythme (jour, semaine, quinzaine ou mois). FCFA. */
  contributionAmount: number;
  /**
   * Durée d'un tour, en périodes du rythme : 10 (jours), 3 (semaines), 2 (mois)…
   * Chaque part cotise contributionAmount × turnLength par tour.
   */
  turnLength: number;
  /** Nombre de parts bénéficiaires payées dans un tour. */
  sharesPerRound?: number;
  /** Montant fixe de frais d'adhésion, facturés une seule fois par personne. */
  membershipFeeAmount?: number;
  /** Ajouter une dernière période de collecte réservée au Superadmin. */
  reserveFinalTurn?: boolean;
  frequency: Frequency;
  /** Nombre total de parts du groupe (une personne peut occuper plusieurs places). */
  maxMembers: number;
  paymentDueDay: number;
  startDate: string; // ISO
  attributionMode: AttributionMode;
  latePenalty?: number;
  status: GroupStatus;
  inviteCode: string;
  createdBy: string;
  /**
   * Administrateur responsable du groupe. Il le gère sans forcément y cotiser
   * (le super administrateur peut le changer, ex. quand un admin part).
   */
  adminId: string;
  /** Groupe terminé rangé aux archives : masqué des listes par défaut. */
  archivedAt?: string;
  /**
   * Qui voit le statut de paiement de chaque membre : tous les membres (par défaut)
   * ou les administrateurs seulement.
   */
  memberStatusVisibility?: 'members' | 'admins';
  /** Numéro du cycle en cours (1 pour le premier). */
  currentCycle: number;
}

export interface Membership {
  id: string;
  groupId: string;
  userId: string;
  role: GroupRole;
  status: MembershipStatus;
  payoutOrder?: number;
  joinedAt: string;
}

export interface Round {
  id: string;
  groupId: string;
  number: number;
  openDate: string;
  dueDate: string;
  beneficiaryId: string;
  /** Membres bénéficiaires de toutes les parts payées par ce tour. */
  beneficiaryMembershipIds?: string[];
  /** `platform` désigne la période finale réservée au Superadmin. */
  recipientType?: 'members' | 'platform';
  /** Montant reçu par personne pour un tour à plusieurs bénéficiaires. */
  beneficiaryAmounts?: Record<string, number>;
  /** Position de la part de ce bénéficiaire parmi ses parts, pour distinguer ses tours. */
  beneficiaryShareNumber?: number;
  beneficiaryShareCount?: number;
  potAmount: number;
  status: RoundStatus;
  paidOutAt?: string;
  /** Administrateur qui a validé le versement de la cagnotte. */
  payoutValidatedBy?: string;
  /** Versement bloqué par le super administrateur (en cas de doute) : la date, et pourquoi. */
  payoutBlockedAt?: string;
  payoutBlockReason?: string;
  /** Cycle auquel appartient le tour. */
  cycle: number;
}

export interface Payment {
  id: string;
  roundId: string;
  userId: string;
  amount: number;
  contributionAmount?: number;
  membershipFeeAmount?: number;
  latePenaltyAmount?: number;
  /**
   * Frais du service de paiement (PayTech), payés par le membre en plus de `amount`.
   * Ils vont au prestataire, jamais dans la cagnotte. Débité : amount + serviceFeeAmount.
   */
  serviceFeeAmount?: number;
  method: PaymentMethod;
  providerRef?: string;
  status: PaymentStatus;
  paidAt?: string;
  /** Date de lancement du paiement (ISO), connue même s'il échoue ou reste en attente. */
  createdAt?: string;
}

export interface PlatformEarning {
  id: string;
  groupId: string;
  kind: 'membership_fee' | 'late_penalty' | 'reserved_turn';
  amount: number;
  at: string;
  paymentId?: string;
  roundId?: string;
  userId?: string;
}

export interface AdminCompensation {
  id: string;
  groupId: string;
  adminId: string;
  amount: number;
  note: string;
  at: string;
  paidBy: string;
}

/** Pénalité appliquée d'office quand la date limite d'un tour est dépassée. */
export interface Penalty {
  id: string;
  roundId: string;
  userId: string;
  amount: number;
  appliedAt: string;
}

export type SwapStatus =
  'pending_partner' | 'pending_admin' | 'approved' | 'rejected' | 'cancelled';

/** Demande d'échange de tour : le partenaire accepte, puis un administrateur valide. */
export interface SwapRequest {
  id: string;
  groupId: string;
  cycle: number;
  requesterId: string;
  partnerId: string;
  requesterRoundId: string;
  partnerRoundId: string;
  status: SwapStatus;
  createdAt: string;
  decidedAt?: string;
}

export interface AppNotification {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  link?: string;
  read: boolean;
  createdAt: string;
}

/** Types d'actions tracées dans le journal d'audit. */
export type AuditAction =
  | 'group_created'
  | 'group_updated'
  | 'group_suspended'
  | 'group_reactivated'
  | 'payout_validated'
  | 'cash_recorded'
  | 'admin_added'
  | 'admin_suspended'
  | 'admin_reactivated'
  | 'admin_revoked'
  | 'settings_updated'
  | 'login'
  | 'group_closed'
  | 'group_archived'
  | 'group_admin_changed'
  | 'groups_reassigned'
  | 'admin_updated'
  | 'admin_deleted'
  | 'pin_reset'
  | 'member_blocked'
  | 'member_unblocked'
  | 'phone_changed'
  | 'member_created'
  | 'payout_blocked'
  | 'payout_unblocked'
  | 'dispute_updated'
  | 'refund_validated'
  | 'announcement_sent'
  | 'admin_compensated'
  | 'community_created'
  | 'community_updated'
  | 'group_community_changed';

/** Entrée du journal d'audit : qui a fait quoi, quand, et sur quel groupe. */
/**
 * Événement de sécurité (rubrique « Sécurité » du super administrateur).
 * En production, c'est le serveur qui les enregistre : lui seul voit toutes les
 * requêtes (tentatives d'injection, accès refusés, essais de PIN).
 */
export type SecurityEventKind =
  | 'pin_failed'
  | 'pin_blocked'
  | 'otp_failed'
  | 'access_denied'
  | 'suspicious_input'
  | 'admin_login';
export type SecuritySeverity = 'info' | 'warning' | 'critical';

export interface SecurityEvent {
  id: string;
  kind: SecurityEventKind;
  severity: SecuritySeverity;
  /** Phrase prête à afficher (ex. « PIN incorrect (2e essai) »). */
  detail: string;
  /** Compte concerné, s'il est connu. */
  userId?: string;
  /** Numéro saisi, quand le compte n'est pas encore identifié. */
  phone?: string;
  at: string;
}

export interface AuditEntry {
  id: string;
  /** Auteur de l'action. */
  actorId: string;
  action: AuditAction;
  /** Phrase prête à afficher, sans le nom de l'auteur (ex. « a créé le groupe … »). */
  summary: string;
  groupId?: string;
  at: string;
}

/** Motif d'une réclamation de membre. */
export type DisputeKind = 'debited_not_recorded' | 'double_payment' | 'wrong_amount' | 'other';
/** Avancement d'un litige. */
export type DisputeStatus = 'open' | 'in_progress' | 'resolved' | 'rejected';

/** Étape du suivi d'un litige (qui a fait quoi, quand). */
export interface DisputeEvent {
  at: string;
  actorId: string;
  text: string;
}

/** Réclamation d'un membre sur un paiement. */
export interface Dispute {
  id: string;
  userId: string;
  groupId: string;
  /** Tour concerné (pour enregistrer un paiement débité mais absent de l'application). */
  roundId?: string;
  /** Paiement concerné, s'il existe dans l'application. */
  paymentId?: string;
  /** Référence du service de paiement donnée par le membre. */
  providerRef?: string;
  /** Moyen utilisé, pour enregistrer le paiement si la réclamation est fondée. */
  method?: PaymentMethod;
  kind: DisputeKind;
  description: string;
  /** Montant en jeu (FCFA). */
  amount: number;
  status: DisputeStatus;
  /** Remboursement validé par le super administrateur. */
  refund?: { amount: number; validatedAt: string; validatedBy: string };
  createdAt: string;
  history: DisputeEvent[];
}

/** Ligne du relevé envoyé par le service de paiement (ce qu'il a réellement encaissé). */
export interface ProviderEntry {
  ref: string;
  phone: string;
  amount: number;
  at: string;
}

/** Raison d'envoi d'un SMS (suivi des coûts). */
export type SmsKind = 'otp' | 'reminder' | 'announcement' | 'payment' | 'payout';

export interface SmsRecord {
  id: string;
  phone: string;
  kind: SmsKind;
  at: string;
  /** Coût facturé par le fournisseur (FCFA). */
  cost: number;
}

/** Messages automatiques modifiables par le super administrateur. */
export type TemplateKey = 'reminder' | 'late' | 'payment' | 'payout';

/** Paramètres de la plateforme (rubrique « Paramètres »). */
/**
 * Paramètres tels que le navigateur les voit. Les clés secrètes (paiement, SMS) n'y
 * figurent jamais : seulement un indice (« •••• 3f9a »). On peut en saisir une nouvelle
 * (voir SettingsService.update), mais jamais relire l'ancienne.
 */
export interface PlatformSettings {
  payment: {
    provider: string;
    publicKey: string;
    /** Fin de la clé secrète enregistrée (« •••• 3f9a »), ou null s'il n'y en a pas. */
    secretKeyHint: string | null;
    /** Frais prélevés par le service de paiement, en %. */
    feePercent: number;
    mode: 'test' | 'prod';
  };
  rules: {
    /** Jours de tolérance après la date limite avant d'être « en retard ». */
    graceDays: number;
    defaultLatePenalty: number;
    minContribution: number;
    maxContribution: number;
    /** Nombre maximal de parts par groupe. */
    maxMembers: number;
  };
  security: {
    otpValidityMinutes: number;
    maxPinAttempts: number;
    inactivityLockMinutes: number;
  };
  sms: {
    provider: string;
    senderName: string;
    /** Fin de la clé du fournisseur SMS enregistrée, ou null s'il n'y en a pas. */
    apiKeyHint: string | null;
    costPerSms: number;
  };
  app: {
    name: string;
    supportPhone: string;
    termsText: string;
    privacyText: string;
    /** Version des deux textes : augmentée par le serveur quand l'un d'eux change. */
    termsVersion: number;
  };
  templates: Record<TemplateKey, string>;
}

/** Clés secrètes : stockées côté serveur seulement, jamais renvoyées au navigateur. */
export interface PlatformSecrets {
  paymentSecretKey: string;
  smsApiKey: string;
}

export * from './views';
