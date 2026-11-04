import type { PayoutRow, PlatformEarningsView, Reconciliation } from '@/types';

/** Argent de la plateforme : réconciliation des paiements et contrôle des versements (super admin). */
export interface FinanceService {
  /** Compare, pour un mois, l'attendu, le relevé du service de paiement et l'enregistré. */
  reconciliation(month: string): Promise<Reconciliation>;
  /** Tous les versements aux bénéficiaires : prévus, prêts, bloqués, effectués. */
  payouts(): Promise<PayoutRow[]>;
  /** Revenus encaissés par le Superadmin et rémunérations versées aux admins. */
  earnings(): Promise<PlatformEarningsView>;
  /** Verse une rémunération facultative à l'administrateur responsable du groupe. */
  compensateAdmin(groupId: string, amount: number, note: string): Promise<void>;
  /** Bloque un versement en cas de doute : l'admin ne peut plus le valider. */
  blockPayout(roundId: string, reason: string): Promise<void>;
  unblockPayout(roundId: string): Promise<void>;
}
