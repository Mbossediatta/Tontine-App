import { downloadCsv } from '@/lib/csv';
import { formatAmount, fullName, paymentMethodLabel } from '@/lib/format';
import type { PaymentStatus, TransactionRow } from '@/types';

export const money = (value: number) => formatAmount(value);
export const paymentStatuses: Record<PaymentStatus, string> = {
  paid: 'Réussie',
  failed: 'Échouée',
  pending: 'En attente',
  late: 'En retard',
  refunded: 'Remboursée',
};

export const disputeStatusLabel = {
  open: 'Ouvert',
  in_progress: 'En cours',
  resolved: 'Résolu',
  rejected: 'Rejeté',
} as const;
export const disputeKindLabel = {
  debited_not_recorded: 'Débit non enregistré',
  double_payment: 'Double paiement',
  wrong_amount: 'Montant incorrect',
  other: 'Autre réclamation',
} as const;

/** Exporte les transactions affichées dans un fichier lisible par Excel. */
export function transactionCsv(rows: TransactionRow[]) {
  downloadCsv(
    [
      [
        'Date',
        'Membre',
        'Téléphone',
        'Groupe',
        'Tour',
        'Moyen',
        'Montant (FCFA)',
        'Statut',
        'Référence',
      ],
      ...rows.map(({ payment, user, groupName, roundNumber }) => [
        payment.createdAt ?? payment.paidAt ?? '',
        fullName(user),
        user.phone ?? '',
        groupName,
        roundNumber,
        paymentMethodLabel(payment.method),
        payment.amount,
        paymentStatuses[payment.status],
        payment.providerRef ?? payment.id,
      ]),
    ],
    `transactions-${new Date().toISOString().slice(0, 10)}.csv`,
  );
}
