import type { DisputeView } from '@/types';

/** Litiges et remboursements (super administrateur). */
export interface DisputeService {
  /** Tous les litiges, du plus récent au plus ancien. */
  list(): Promise<DisputeView[]>;
  /** Passe le litige « en cours » : le super administrateur s'en occupe. */
  take(disputeId: string): Promise<void>;
  /** Paiement débité mais absent de l'appli : l'enregistre comme payé et clôt le litige. */
  recordPayment(disputeId: string): Promise<void>;
  /** Valide un remboursement (montant en FCFA) et clôt le litige. */
  refund(disputeId: string, amount: number, note: string): Promise<void>;
  /** Clôt le litige sans suite, avec l'explication donnée au membre. */
  reject(disputeId: string, note: string): Promise<void>;
}
