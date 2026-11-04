import type { MemberView } from '@/types';

export interface MembershipService {
  /** Membres actifs et, pour les administrateurs du groupe, demandes en attente. */
  list(groupId: string): Promise<MemberView[]>;
  accept(membershipId: string): Promise<void>;
  reject(membershipId: string): Promise<void>;
  remove(membershipId: string): Promise<void>;
  setRole(membershipId: string, role: 'co_admin' | 'member'): Promise<void>;
  /** Ajoute une personne avec le nombre demandé de parts, ou des parts supplémentaires. */
  addByPhone(groupId: string, phone: string, shareCount?: number): Promise<number>;
}
