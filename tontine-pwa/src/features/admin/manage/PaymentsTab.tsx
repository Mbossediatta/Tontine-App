import { useState } from 'react';
import { BellRing, Download, FlaskConical, Receipt } from 'lucide-react';
import { AmountText, StatusBadge } from '@/components/domain';
import { OnlineButton } from '@/components/layout/OnlineButton';
import { AsyncContent, Button, Card, EmptyState, Select } from '@/components/ui';
import { useRounds } from '@/features/groups/queries';
import { env } from '@/lib/env';
import { formatDate, fullName, paymentMethodLabel } from '@/lib/format';
import { useAction } from '@/lib/query';
import { paymentService } from '@/services';
import type { GroupOverview, PaymentStatus, RoundPaymentRow, RoundView } from '@/types';
import { useRoundPayments } from '../queries';
import { CashPaymentDialog } from './CashPaymentDialog';

/** Colonnes sur écran large : membre · statut · moyen · date · référence. */
const COLUMNS =
  'md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]';

const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: 'En attente',
  paid: 'Payé',
  late: 'En retard',
  failed: 'Échoué',
  refunded: 'Remboursé',
};

function csvCell(value: string | number): string {
  const safeValue = String(value).replace(/^[=+\-@\t\r]/, "'$&");
  return `"${safeValue.replace(/"/g, '""')}"`;
}

function downloadCycleReport(
  groupName: string,
  rounds: Array<{ round: RoundView['round']; beneficiary: RoundView['beneficiary'] }>,
  rowsByRound: RoundPaymentRow[][],
) {
  const header = [
    'Groupe',
    'Cycle',
    'Tour',
    'Échéance',
    'Bénéficiaire',
    'Membre',
    'Nombre de parts',
    'Téléphone',
    'Statut',
    'Montant payé (FCFA)',
    'Pénalité (FCFA)',
    'Moyen de paiement',
    'Date de paiement',
    'Référence',
  ];
  const rows = rounds.flatMap(({ round, beneficiary }, index) =>
    (rowsByRound[index] ?? []).map(({ user, status, payment, penalty, shareCount }) => [
      groupName,
      round.cycle,
      round.number,
      formatDate(round.dueDate),
      fullName(beneficiary),
      fullName(user),
      shareCount,
      user.phone ?? '',
      PAYMENT_STATUS_LABELS[status],
      payment?.amount ?? 0,
      penalty,
      payment ? paymentMethodLabel(payment.method) : '',
      payment?.paidAt ? formatDate(payment.paidAt) : '',
      payment?.providerRef ?? '',
    ]),
  );
  const content = [header, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n');
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const safeGroupName = groupName.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  link.href = url;
  link.download = `releve-${safeGroupName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-cycle.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

const FILTERS: Array<{ value: PaymentStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Tous les statuts' },
  { value: 'paid', label: 'Payé' },
  { value: 'pending', label: 'En attente' },
  { value: 'late', label: 'En retard' },
  { value: 'failed', label: 'Échoué' },
];

export function PaymentsTab({ overview }: { overview: GroupOverview }) {
  const roundsQuery = useRounds(overview.group.id);
  const started = (roundsQuery.data ?? []).filter((r) => r.round.status !== 'upcoming');
  const [selected, setSelected] = useState<string>();
  const [filter, setFilter] = useState<PaymentStatus | 'all'>('all');
  const [cashOpen, setCashOpen] = useState(false);
  const roundId = selected ?? overview.currentRound?.id ?? started[started.length - 1]?.round.id;
  const round = started.find((r) => r.round.id === roundId)?.round;
  const paymentsQuery = useRoundPayments(roundId);

  const remind = useAction({
    action: () => paymentService.remindLate(roundId ?? ''),
    success: (count: number) =>
      count > 0 ? `${count} membre(s) relancé(s)` : 'Tout le monde a payé',
  });
  const remindMember = useAction({
    action: (userId: string) => paymentService.remindMember(roundId ?? '', userId),
    success: 'Rappel envoyé',
  });
  const exportReport = useAction({
    action: async () => {
      const reportRounds = started.filter(({ round: item }) => item.status !== 'upcoming');
      const reportRows = await Promise.all(
        reportRounds.map(({ round: item }) => paymentService.listForRound(item.id)),
      );
      downloadCycleReport(
        overview.group.name,
        reportRounds.map(({ round: item, beneficiary }) => ({ round: item, beneficiary })),
        reportRows,
      );
      return reportRounds.length;
    },
    success: (count: number) => `Relevé exporté · ${count} tour(s)`,
  });

  const deadline = useAction({
    // Démonstration seulement : la simulation n'est chargée qu'au clic.
    action: async (id: string) =>
      (await import('@/services/mock/clock')).simulateDeadlinePassed(id),
    success: 'Date limite dépassée : pénalités appliquées aux retardataires',
  });

  if (overview.group.status === 'draft') {
    return (
      <EmptyState
        title="Aucun paiement"
        description="Les paiements commenceront au démarrage du cycle."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Tour"
          value={roundId ?? ''}
          onChange={(e) => setSelected(e.target.value)}
          options={started.map(({ round: r }) => ({
            value: r.id,
            label: `Tour ${r.number} · ${formatDate(r.dueDate)}`,
          }))}
        />
        <Select
          label="Filtrer"
          value={filter}
          onChange={(e) => setFilter(e.target.value as PaymentStatus | 'all')}
          options={FILTERS}
        />
      </div>
      <Button
        variant="secondary"
        className="self-start"
        loading={exportReport.isPending}
        disabled={started.length === 0}
        onClick={() => exportReport.mutate()}
        icon={<Download className="h-5 w-5" aria-hidden="true" />}
      >
        Exporter le relevé du cycle (CSV)
      </Button>
      {round?.status === 'open' ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <OnlineButton
            variant="secondary"
            block
            onClick={() => setCashOpen(true)}
            icon={<Receipt className="h-5 w-5" aria-hidden="true" />}
          >
            Enregistrer un paiement en espèces
          </OnlineButton>
          <OnlineButton
            variant="secondary"
            block
            loading={remind.isPending}
            onClick={() => remind.mutate()}
            icon={<BellRing className="h-5 w-5" aria-hidden="true" />}
          >
            Relancer les retardataires
          </OnlineButton>
        </div>
      ) : null}
      {env.useMocks && round?.status === 'open' ? (
        <Button
          variant="ghost"
          size="sm"
          loading={deadline.isPending}
          onClick={() => deadline.mutate(round.id)}
          icon={<FlaskConical className="h-4 w-4" aria-hidden="true" />}
          className="self-start"
        >
          Démo : simuler la date limite dépassée
        </Button>
      ) : null}
      <AsyncContent query={paymentsQuery}>
        {(rows) => {
          const visible = rows.filter((row) => filter === 'all' || row.status === filter);
          return (
            <Card padded={false} className="px-4">
              {/* En-têtes : seulement quand les colonnes existent (écran ≥ 768 px). */}
              <div
                className={`hidden gap-3 border-b border-line py-3 text-label text-muted md:grid ${COLUMNS}`}
                aria-hidden="true"
              >
                <span>Membre / parts</span>
                <span>Statut</span>
                <span>Moyen</span>
                <span>Date</span>
                <span>Référence</span>
                <span>Action</span>
              </div>
              <ul className="divide-y divide-line">
                {visible.map(({ user, status, payment, penalty, shareCount }) => (
                  // Téléphone : une carte par membre (nom + statut, montant, puis
                  // moyen · date · référence). Écran large : une ligne en colonnes.
                  <li
                    key={user.id}
                    className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-3 text-label ${COLUMNS}`}
                  >
                    <div className="min-w-0 font-medium text-ink">
                      <span className="block truncate">{fullName(user)}</span>
                      {shareCount > 1 ? (
                        <span className="block text-small text-muted">{shareCount} parts</span>
                      ) : null}
                      {payment && status === 'paid' ? (
                        <span className="block text-muted">
                          <AmountText value={payment.amount} />
                        </span>
                      ) : penalty > 0 ? (
                        <span className="block text-danger">
                          + <AmountText value={penalty} /> de pénalité
                        </span>
                      ) : null}
                    </div>
                    <span className="justify-self-end md:justify-self-auto">
                      <StatusBadge status={status} />
                    </span>
                    {/* Sur téléphone, ces trois infos tiennent sur une ligne, en gris. */}
                    <span className="col-span-2 text-small text-muted md:col-span-1 md:text-label md:text-ink">
                      {payment && status !== 'late' ? paymentMethodLabel(payment.method) : '—'}
                      <span className="md:hidden">
                        {payment?.paidAt ? ` · ${formatDate(payment.paidAt)}` : ''}
                        {payment?.providerRef ? ` · ${payment.providerRef}` : ''}
                      </span>
                    </span>
                    <span className="hidden text-ink md:block">
                      {payment?.paidAt ? formatDate(payment.paidAt) : '—'}
                    </span>
                    <span className="hidden truncate text-muted md:block">
                      {payment?.providerRef ?? '—'}
                    </span>
                    <span className="col-span-2 md:col-span-1 md:justify-self-end">
                      {round?.status === 'open' &&
                      (status === 'pending' || status === 'late' || status === 'failed') ? (
                        <OnlineButton
                          size="sm"
                          variant="ghost"
                          loading={remindMember.isPending}
                          onClick={() => remindMember.mutate(user.id)}
                          icon={<BellRing className="h-4 w-4" aria-hidden="true" />}
                        >
                          Relancer
                        </OnlineButton>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
              {visible.length === 0 ? (
                <p className="py-6 text-center text-muted">Aucun paiement avec ce statut.</p>
              ) : null}
            </Card>
          );
        }}
      </AsyncContent>
      {round ? (
        <CashPaymentDialog
          open={cashOpen}
          onClose={() => setCashOpen(false)}
          roundId={round.id}
          rows={paymentsQuery.data ?? []}
        />
      ) : null}
    </div>
  );
}
