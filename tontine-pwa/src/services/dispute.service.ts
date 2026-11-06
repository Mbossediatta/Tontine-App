import type { DisputeView, MyDispute, OpenDisputeInput } from '@/types';

/** Litiges et remboursements : réclamations des membres, traitement par le super admin. */
export interface DisputeService {
  /** Le membre ouvre une réclamation (paiement, cagnotte non reçue…). */
  open(input: OpenDisputeInput): Promise<void>;
  /** Mes réclamations et leur suivi, de la plus récente à la plus ancienne. */
  listMine(): Promise<MyDispute[]>;
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
