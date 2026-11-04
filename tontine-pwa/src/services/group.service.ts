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
}
