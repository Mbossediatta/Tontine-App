import type { MemberView, RoundView, PayoutMethod } from '@/types';

export interface RoundService {
  list(groupId: string): Promise<RoundView[]>;
  /** Tirage au sort de l'ordre des bénéficiaires ; renvoie les membres dans l'ordre tiré. */
  drawOrder(groupId: string): Promise<MemberView[]>;
  setManualOrder(groupId: string, membershipIds: string[]): Promise<void>;
  payout(roundId: string): Promise<void>;
  /** L'admin a envoyé la cagnotte de `userId` (référence de la transaction). */
  markPayoutSent(roundId: string, userId: string, method: PayoutMethod, ref: string): Promise<void>;
  /** Le bénéficiaire confirme avoir reçu l'argent. */
  confirmPayoutReceived(roundId: string): Promise<void>;
}
