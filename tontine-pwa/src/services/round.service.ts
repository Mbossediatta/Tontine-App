import type { MemberView, RoundView } from '@/types';

export interface RoundService {
  list(groupId: string): Promise<RoundView[]>;
  /** Tirage au sort de l'ordre des bénéficiaires ; renvoie les membres dans l'ordre tiré. */
  drawOrder(groupId: string): Promise<MemberView[]>;
  setManualOrder(groupId: string, membershipIds: string[]): Promise<void>;
  payout(roundId: string): Promise<void>;
}
