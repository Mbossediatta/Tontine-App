import type {
  CreateGroupInput,
  Group,
  GroupOverview,
  JoinPreview,
  RestartCycleInput,
  UpdateGroupInput,
} from '@/types';

export interface GroupService {
  /** Groupes dont je suis membre actif (ou demandeur en attente). */
  listMine(): Promise<GroupOverview[]>;
  /** Groupes ouverts des communautés auxquelles le membre appartient déjà. */
  listDiscoverable(): Promise<GroupOverview[]>;
  /** Groupes que je gère (propriétaire ou co-admin) ; tous pour le super administrateur. */
  listManaged(): Promise<GroupOverview[]>;
  get(groupId: string): Promise<GroupOverview>;
  create(input: CreateGroupInput): Promise<Group>;
  update(groupId: string, input: UpdateGroupInput): Promise<Group>;
  start(groupId: string): Promise<Group>;
  remove(groupId: string): Promise<void>;
  regenerateInviteCode(groupId: string): Promise<string>;
  /** Relance un groupe terminé : nouveau cycle avec les mêmes membres, en brouillon. */
  restartCycle(groupId: string, input: RestartCycleInput): Promise<Group>;
  getByInviteCode(code: string): Promise<JoinPreview>;
  requestJoin(code: string): Promise<void>;
  /** Demande à rejoindre un groupe ouvert de l'une de ses communautés. */
  requestJoinOpen(groupId: string): Promise<void>;
  /** Envoie une annonce (notification) à tous les membres ; renvoie le nombre de destinataires. */
  announce(groupId: string, message: string): Promise<number>;
  /** Denthie : fixe la date de répartition (« yyyy-MM-dd »), ou la retire (null). */
  setEndDate(groupId: string, endDate: string | null): Promise<void>;
  /**
   * Denthie : lance la répartition (à partir de la date prévue). À partir de 300 000 FCFA,
   * un admin ne fait qu'une demande (« pending_approval ») : le super admin valide.
   */
  distribute(groupId: string): Promise<'paid' | 'pending_approval'>;
  /** Denthie : le membre connecté demande un retrait d'urgence. */
  requestWithdrawal(groupId: string, reason: string): Promise<void>;
  /** Denthie : l'admin accorde le retrait d'urgence ; la personne reçoit son épargne et sort. */
  withdraw(groupId: string, userId: string, reason: string): Promise<void>;
}
