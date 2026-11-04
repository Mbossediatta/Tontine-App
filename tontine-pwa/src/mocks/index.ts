import type {
  AppNotification,
  AuditEntry,
  SecurityEvent,
  AdminCompensation,
  Community,
  Dispute,
  PlatformSecrets,
  PlatformSettings,
  ProviderEntry,
  SmsRecord,
  Group,
  Membership,
  NotificationPreferences,
  Payment,
  PlatformEarning,
  Penalty,
  SwapRequest,
  Round,
  User,
} from '@/types';
import { seedAudit } from './audit';
import { seedSecurityEvents } from './security';
import { seedDisputes, seedProviderLedger, seedSecrets, seedSettings, seedSms } from './backoffice';
import { seedPins } from './pins';
import { seedGroups } from './groups';
import { seedNotifications } from './notifications';
import { seedUsers } from './users';

export { DEMO_ACCOUNTS } from './users';

/**
 * PIN d'un utilisateur (simulé). Le PIN n'est jamais stocké en clair : seule son
 * empreinte l'est. Le backend utilisera un vrai hachage lent (Argon2 ou bcrypt).
 */
export interface PinRecord {
  hash: string;
  /** Essais ratés consécutifs ; remis à zéro à la connexion réussie. */
  failedAttempts: number;
  /** PIN à recréer après un code SMS (oublié, bloqué ou réinitialisé par le super admin). */
  mustReset: boolean;
}

export interface MockDatabase {
  users: User[];
  communities: Community[];
  groups: Group[];
  memberships: Membership[];
  rounds: Round[];
  payments: Payment[];
  platformEarnings: PlatformEarning[];
  adminCompensations: AdminCompensation[];
  penalties: Penalty[];
  swapRequests: SwapRequest[];
  notifications: AppNotification[];
  preferences: Record<string, NotificationPreferences>;
  pushSubscriptions: Record<string, unknown>;
  /** Paiements simulés en attente de confirmation par l'agrégateur (id → horodatage). */
  pendingConfirmations: Record<string, { at: number; success: boolean }>;
  /** Journal d'audit, du plus ancien au plus récent. */
  auditLog: AuditEntry[];
  /** Événements de sécurité (tentatives de connexion, accès refusés, saisies suspectes). */
  securityEvents: SecurityEvent[];
  /** PIN de connexion, par identifiant d'utilisateur. */
  pins: Record<string, PinRecord>;
  /** Réclamations des membres (litiges et remboursements). */
  disputes: Dispute[];
  /** Relevé du service de paiement, pour la réconciliation. */
  providerLedger: ProviderEntry[];
  /** SMS envoyés (codes, rappels, annonces), pour le suivi des coûts. */
  smsLog: SmsRecord[];
  settings: PlatformSettings;
  /** Clés secrètes (paiement, SMS) : côté serveur seulement, jamais renvoyées à la page. */
  secrets: PlatformSecrets;
}

export function createSeed(now: Date = new Date()): MockDatabase {
  const users = seedUsers(now);
  const groups = seedGroups(now);
  const communities: Community[] = [
    {
      id: 'c-ouakam',
      name: 'Ouakam',
      description: 'Communauté des groupes de Ouakam et des quartiers voisins.',
      adminIds: ['u-admin1'],
      createdAt: now.toISOString(),
    },
    {
      id: 'c-afp',
      name: 'AFP',
      description: 'Espace des groupes de la communauté AFP.',
      adminIds: ['u-admin2'],
      createdAt: now.toISOString(),
    },
  ];
  for (const group of groups.groups) {
    group.communityId = group.adminId === 'u-admin1' ? 'c-ouakam' : 'c-afp';
  }
  return {
    users,
    communities,
    ...groups,
    platformEarnings: [],
    adminCompensations: [],
    notifications: seedNotifications(now),
    swapRequests: [],
    preferences: {},
    pushSubscriptions: {},
    pendingConfirmations: {},
    auditLog: seedAudit(now),
    securityEvents: seedSecurityEvents(now),
    pins: seedPins(),
    disputes: seedDisputes(now),
    providerLedger: seedProviderLedger(groups.payments, users, now),
    smsLog: seedSms(users, now),
    settings: seedSettings(),
    secrets: seedSecrets(),
  };
}
