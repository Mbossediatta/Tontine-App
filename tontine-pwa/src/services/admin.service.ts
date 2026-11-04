import type {
  AdminDashboard,
  AccountInput,
  AdminChoice,
  AdminPerformance,
  Community,
  SaveCommunityInput,
  SuperAdminDashboard,
  TransactionRow,
} from '@/types';

/** Opérations du tableau de bord et de la supervision (super administrateur sauf `dashboard`). */
export interface AdminService {
  /** Indicateurs et tâches pour les groupes que je gère. */
  dashboard(): Promise<AdminDashboard>;
  /** Vue globale de la plateforme. */
  superDashboard(): Promise<SuperAdminDashboard>;
  /** Toutes les transactions de la plateforme, de la plus récente à la plus ancienne. */
  listTransactions(): Promise<TransactionRow[]>;

  // --- Administrateurs ---
  listAdmins(): Promise<AdminPerformance[]>;
  /** Admins actifs à qui confier un groupe (nom seulement) : ouvert aux administrateurs. */
  listAdminChoices(): Promise<AdminChoice[]>;
  getAdmin(userId: string): Promise<AdminPerformance>;
  /** Nomme un administrateur ; s'il n'a pas de compte, il est créé (SMS puis PIN à la 1re connexion). */
  createAdmin(input: AccountInput): Promise<void>;
  updateAdmin(userId: string, input: AccountInput): Promise<void>;
  suspend(userId: string): Promise<void>;
  reactivate(userId: string): Promise<void>;
  /** Retire le rôle d'administrateur (il redevient participant). Ses groupes doivent être réattribués avant. */
  deleteAdmin(userId: string): Promise<void>;
  /** Transfère tous les groupes dont `fromId` est responsable à `toId` ; renvoie leur nombre. */
  reassignGroups(fromId: string, toId: string): Promise<number>;

  // --- Communautés ---
  /** Liste des communautés et de leurs administrateurs affectés. */
  listCommunities(): Promise<Community[]>;
  /** Crée une communauté ou met à jour son nom, sa description et ses admins. */
  saveCommunity(input: SaveCommunityInput): Promise<Community>;

  // --- Supervision des groupes ---
  suspendGroup(groupId: string): Promise<void>;
  reactivateGroup(groupId: string): Promise<void>;
  /** Arrête définitivement le groupe (plus de paiements ni de versements). */
  closeGroup(groupId: string): Promise<void>;
  /** Range un groupe terminé aux archives. */
  archiveGroup(groupId: string): Promise<void>;
  changeGroupAdmin(groupId: string, adminId: string): Promise<void>;
  /** Transfère un groupe et son admin responsable vers une communauté. */
  transferGroup(groupId: string, communityId: string, adminId: string): Promise<void>;
}
