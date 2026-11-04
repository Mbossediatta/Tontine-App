import { useState } from 'react';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { AmountText, StatusBadge } from '@/components/domain';
import { Button, Card, CardTitle } from '@/components/ui';
import { downloadCsv } from '@/lib/csv';
import { errorMessage } from '@/lib/errors';
import { formatDateTime, formatPhone, fullName, paymentMethodLabel } from '@/lib/format';
import { adminService } from '@/services';
import type { PaymentStatus, TransactionRow } from '@/types';

/** Libellés « transaction » (au féminin) des statuts de paiement. */
const TRANSACTION_LABELS: Record<PaymentStatus, string> = {
  paid: 'Réussie',
  failed: 'Échouée',
  pending: 'En attente',
  late: 'En retard',
  refunded: 'Remboursée',
};

/** Référence affichée : celle du service de paiement, sinon la fin de l'identifiant interne. */
function reference(row: TransactionRow): string {
  return row.payment.providerRef ?? `#${row.payment.id.slice(-6).toUpperCase()}`;
}

/** Exporte toutes les transactions de la plateforme dans un fichier lisible par Excel. */
async function exportTransactions(): Promise<void> {
  const rows = await adminService.listTransactions();
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
      ...rows.map((row) => {
        const date = row.payment.createdAt ?? row.payment.paidAt;
        return [
          date ? formatDateTime(date) : '',
          fullName(row.user),
          row.user.phone ? formatPhone(row.user.phone) : '',
          row.groupName,
          row.roundNumber,
          paymentMethodLabel(row.payment.method),
          row.payment.amount,
          TRANSACTION_LABELS[row.payment.status],
          reference(row),
        ];
      }),
    ],
    `transactions-${new Date().toISOString().slice(0, 10)}.csv`,
  );
}

/** « Transactions récentes » : les derniers paiements de la plateforme, avec export Excel. */
export function TransactionsCard({ transactions }: { transactions: TransactionRow[] }) {
  const [exporting, setExporting] = useState(false);

  const onExport = async () => {
    setExporting(true);
    try {
      await exportTransactions();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <CardTitle>Transactions récentes</CardTitle>
        <Button
          variant="outline"
          size="sm"
          loading={exporting}
          onClick={() => void onExport()}
          icon={<Download className="h-4 w-4" aria-hidden="true" />}
        >
          Exporter
        </Button>
      </div>
      {transactions.length === 0 ? (
        <p className="text-muted">Aucune transaction pour le moment.</p>
      ) : (
        <TransactionList rows={transactions} />
      )}
    </Card>
  );
}

/**
 * Transactions en lignes compactes, lisibles sur téléphone.
 * `detailed` : ajoute le tour et la date (page Transactions).
 */
export function TransactionList({
  rows,
  detailed = false,
}: {
  rows: TransactionRow[];
  detailed?: boolean;
}) {
  return (
    <ul className="divide-y divide-line">
      {rows.map((row) => {
        const date = row.payment.createdAt ?? row.payment.paidAt;
        return (
          // Mobile : nom et montant sur la 1re ligne, détails et statut sur la 2e.
          // Écran large : 4 colonnes (membre · moyen · montant · statut).
          <li
            key={row.payment.id}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto_auto]"
          >
            <div className="min-w-0">
              <p className="truncate font-bold text-ink">{fullName(row.user)}</p>
              <p className="truncate text-small text-muted">
                {reference(row)} · {row.groupName}
                {detailed ? ` · Tour ${row.roundNumber}` : ''}
              </p>
              {detailed && date ? (
                <p className="text-small text-muted">{formatDateTime(date)}</p>
              ) : null}
            </div>
            <span className="hidden whitespace-nowrap text-label text-muted sm:block">
              {paymentMethodLabel(row.payment.method)}
            </span>
            <AmountText value={row.payment.amount} className="text-right font-bold text-ink" />
            <span className="col-span-2 flex items-center justify-between gap-2 sm:col-span-1 sm:justify-end">
              <span className="text-small text-muted sm:hidden">
                {paymentMethodLabel(row.payment.method)}
              </span>
              <StatusBadge
                status={row.payment.status}
                label={TRANSACTION_LABELS[row.payment.status]}
              />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
