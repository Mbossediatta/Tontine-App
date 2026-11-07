import type { MemberView, RoundView, PayoutMethod } from '@/types';

export interface RoundService {
  list(groupId: string): Promise<RoundView[]>;
  /** Tirage au sort de l'ordre des bénéficiaires ; renvoie les membres dans l'ordre tiré. */
  drawOrder(groupId: string): Promise<MemberView[]>;
  setManualOrder(groupId: string, membershipIds: string[]): Promise<void>;
  /**
   * Valide le versement. À partir de 300 000 FCFA, un admin du groupe ne fait qu'une demande
   * (« pending_approval ») : le super admin valide.
   */
  payout(roundId: string): Promise<'paid' | 'pending_approval'>;
  /** Envoi automatique de la cagnotte (PayTech), quand il est activé. */
  sendPayoutAuto(roundId: string, userId: string): Promise<void>;
  /** L'admin a envoyé la cagnotte de `userId` (référence de la transaction). */
  markPayoutSent(roundId: string, userId: string, method: PayoutMethod, ref: string): Promise<void>;
  /** Le bénéficiaire confirme avoir reçu l'argent. */
  confirmPayoutReceived(roundId: string): Promise<void>;
}
