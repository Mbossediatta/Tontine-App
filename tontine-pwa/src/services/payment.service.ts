import type {
  DebtView,
  InitiatePaymentInput,
  InitiatePaymentResult,
  MyGroupHistory,
  MyTransaction,
  PaymentReceipt,
  RoundPaymentRow,
} from '@/types';

export interface PaymentService {
  listForRound(roundId: string): Promise<RoundPaymentRow[]>;
  listMine(groupId: string): Promise<MyGroupHistory>;
  /** Mes cotisations et cagnottes reçues dans tous mes groupes, de la plus récente à la plus ancienne. */
  myTransactions(): Promise<MyTransaction[]>;
  initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentResult>;
  /** Statut à jour d'un paiement (interrogé après le retour de l'agrégateur). */
  getReceipt(paymentId: string): Promise<PaymentReceipt>;
  /** Espèces reçues : quelques jours (ou périodes) du tour, ou tout le reste sans `periods`. */
  recordCash(roundId: string, userId: string, periods?: number): Promise<void>;
  /** Impayés devenus dettes : tous pour un admin du groupe, les miens pour un membre. */
  listDebts(groupId: string): Promise<DebtView[]>;
  /** Le membre rembourse sa dette en ligne (Wave, Orange Money) : page de paiement. */
  payDebt(debtId: string, method: InitiatePaymentInput['method']): Promise<InitiatePaymentResult>;
  /** Remboursement d'une dette reçu en espèces (admin du groupe). */
  recordDebtPayment(debtId: string): Promise<void>;
  /** Envoie un rappel aux retardataires ; renvoie le nombre de personnes relancées. */
  remindLate(roundId: string): Promise<number>;
  /** Envoie un rappel à un seul membre qui n'a pas encore payé. */
  remindMember(roundId: string, userId: string): Promise<void>;
}
