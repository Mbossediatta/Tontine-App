import { Badge } from '@/components/ui';
import { formatDateTime, fullName, paymentMethodLabel } from '@/lib/format';
import type { TransactionRow } from '@/types';
import { money, paymentStatuses } from './labels';

/** Tableau complet des transactions, pour les écrans d'ordinateur. */
export function TransactionsTable({ rows }: { rows: TransactionRow[] }) {
  return (
    <table className="w-full text-left text-label">
      <thead className="border-b border-line text-small uppercase text-muted">
        <tr>
          <th className="py-2">Membre / référence</th>
          <th>Groupe</th>
          <th>Date</th>
          <th>Moyen</th>
          <th>Montant</th>
          <th>Statut</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map(({ payment, user, groupName, roundNumber }) => (
          <tr key={payment.id}>
            <td className="py-3">
              <strong>{fullName(user)}</strong>
              <span className="block text-small text-muted">
                {payment.providerRef ?? payment.id} · Tour {roundNumber}
              </span>
            </td>
            <td>{groupName}</td>
            <td>{formatDateTime(payment.createdAt ?? payment.paidAt ?? new Date())}</td>
            <td>{paymentMethodLabel(payment.method)}</td>
            <td className="whitespace-nowrap font-bold">{money(payment.amount)}</td>
            <td>
              <Badge
                tone={
                  payment.status === 'paid'
                    ? 'success'
                    : payment.status === 'failed' || payment.status === 'late'
                      ? 'danger'
                      : 'info'
                }
              >
                {paymentStatuses[payment.status]}
              </Badge>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
