import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, startOfMonth } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Ban, Download, LockKeyhole, Send } from 'lucide-react';
import { AmountText } from '@/components/domain';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge, Button, Card, CardTitle, Input, Select, Textarea } from '@/components/ui';
import { cn } from '@/lib/cn';
import { downloadCsv } from '@/lib/csv';
import {
  formatAmount,
  formatDate,
  formatDateTime,
  fullName,
  paymentMethodLabel,
} from '@/lib/format';
import { queryKeys, useAction } from '@/lib/query';
import {
  adminService,
  communicationService,
  disputeService,
  financeService,
  groupService,
  reportService,
  roundService,
  settingsService,
} from '@/services';
import type {
  DisputeView,
  PaymentStatus,
  PlatformReport,
  PlatformSettings,
  PayoutRow,
  TransactionRow,
} from '@/types';
import { CollapsibleFilters } from '../components/ListToolbar';
import { useShowMore } from '../components/useShowMore';
import { TransactionList } from '../super/TransactionsCard';

const money = (value: number) => formatAmount(value);
const paymentStatuses: Record<PaymentStatus, string> = {
  paid: 'Réussie',
  failed: 'Échouée',
  pending: 'En attente',
  late: 'En retard',
  refunded: 'Remboursée',
};

function PageFrame({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={title} subtitle={subtitle} plain />
      {children}
    </div>
  );
}

function QueryState({
  query,
  children,
}: {
  query: { isPending: boolean; isError: boolean; error: Error | null };
  children: React.ReactNode;
}) {
  if (query.isPending) {
    return (
      <Card>
        <p role="status" className="text-muted">
          Chargement des données…
        </p>
      </Card>
    );
  }
  if (query.isError) {
    return (
      <Card role="alert" className="border border-danger/30">
        <p className="font-bold text-danger">Impossible de charger cette rubrique.</p>
        <p className="mt-1 text-label text-muted">{query.error?.message}</p>
      </Card>
    );
  }
  return children;
}

function Stat({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('flex flex-col gap-1', className)}>
      <span className="text-label text-muted">{label}</span>
      <strong className="font-display text-section tabular-nums text-blue-900">{value}</strong>
    </Card>
  );
}

function transactionCsv(rows: TransactionRow[]) {
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

export function TransactionsPage() {
  const [status, setStatus] = useState('');
  const [method, setMethod] = useState('');
  const [groupId, setGroupId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [month, setMonth] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const transactions = useQuery({
    queryKey: ['admin', 'transactions'],
    queryFn: () => adminService.listTransactions(),
  });
  const groups = useQuery({
    queryKey: queryKeys.managedGroups,
    queryFn: () => groupService.listManaged(),
  });
  const reconciliation = useQuery({
    queryKey: ['admin', 'reconciliation', month],
    queryFn: () => financeService.reconciliation(month),
  });
  const rows = useMemo(
    () =>
      (transactions.data ?? []).filter(
        ({ payment, groupId: rowGroupId }) =>
          (!status || payment.status === status) &&
          (!method || payment.method === method) &&
          (!groupId || rowGroupId === groupId) &&
          (!from || (payment.createdAt ?? payment.paidAt ?? '').slice(0, 10) >= from) &&
          (!to || (payment.createdAt ?? payment.paidAt ?? '').slice(0, 10) <= to),
      ),
    [transactions.data, status, method, groupId, from, to],
  );
  const filters = [status, method, groupId, from, to];
  const page = useShowMore(rows, 20, filters.join('|'));

  return (
    <PageFrame
      title="Transactions"
      subtitle="Historique des paiements et rapprochement avec le prestataire."
    >
      <QueryState query={transactions}>
        <>
          {/* Téléphone : le montant sur toute la largeur, les deux compteurs côte à côte. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat
              label="Montant payé"
              className="col-span-2 sm:col-span-1"
              value={money(
                rows
                  .filter((row) => row.payment.status === 'paid')
                  .reduce((sum, row) => sum + row.payment.amount, 0),
              )}
            />
            <Stat label="Transactions affichées" value={rows.length} />
            <Stat
              label="En attente / en échec"
              value={
                rows.filter((row) => ['pending', 'failed'].includes(row.payment.status)).length
              }
            />
          </div>
          <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <CardTitle>Historique des paiements</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => transactionCsv(rows)}
                icon={<Download className="h-4 w-4" aria-hidden="true" />}
              >
                Exporter CSV
              </Button>
            </div>
            <CollapsibleFilters
              activeCount={filters.filter(Boolean).length}
              className="grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5"
            >
              <Input
                label="À partir du"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
              <Input
                label="Jusqu’au"
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
              <Select
                label="Statut"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                options={[
                  { value: 'paid', label: 'Réussie' },
                  { value: 'pending', label: 'En attente' },
                  { value: 'failed', label: 'Échouée' },
                  { value: 'late', label: 'En retard' },
                  { value: 'refunded', label: 'Remboursée' },
                ]}
                placeholder="Tous les statuts"
              />
              <Select
                label="Moyen de paiement"
                value={method}
                onChange={(event) => setMethod(event.target.value)}
                options={[
                  { value: 'wave', label: 'Wave' },
                  { value: 'orange_money', label: 'Orange Money' },
                  { value: 'free_money', label: 'Free Money' },
                  { value: 'cash', label: 'Espèces' },
                ]}
                placeholder="Tous les moyens"
              />
              <Select
                label="Groupe"
                value={groupId}
                onChange={(event) => setGroupId(event.target.value)}
                options={(groups.data ?? []).map(({ group }) => ({
                  value: group.id,
                  label: group.name,
                }))}
                placeholder="Tous les groupes"
              />
            </CollapsibleFilters>
            {rows.length ? (
              <>
                {/* Téléphone et tablette : lignes compactes ; ordinateur : tableau complet. */}
                <div className="lg:hidden">
                  <TransactionList rows={page.visible} detailed />
                </div>
                <div className="hidden lg:block">
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
                      {page.visible.map(({ payment, user, groupName, roundNumber }) => (
                        <tr key={payment.id}>
                          <td className="py-3">
                            <strong>{fullName(user)}</strong>
                            <span className="block text-small text-muted">
                              {payment.providerRef ?? payment.id} · Tour {roundNumber}
                            </span>
                          </td>
                          <td>{groupName}</td>
                          <td>
                            {formatDateTime(payment.createdAt ?? payment.paidAt ?? new Date())}
                          </td>
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
                </div>
                {page.more}
              </>
            ) : (
              <p className="text-muted">Aucune transaction ne correspond à ces filtres.</p>
            )}
          </Card>
        </>
      </QueryState>
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <CardTitle>Réconciliation</CardTitle>
            <p className="mt-1 text-label text-muted">
              Compare les encaissements de l’application au relevé du service de paiement.
            </p>
          </div>
          <Input
            label="Mois"
            type="month"
            value={month.slice(0, 7)}
            onChange={(event) => setMonth(`${event.target.value}-01`)}
          />
        </div>
        <QueryState query={reconciliation}>
          {reconciliation.data ? (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Stat
                  label="Attendu"
                  className="col-span-2 sm:col-span-1"
                  value={money(reconciliation.data.expected)}
                />
                <Stat
                  label="Enregistré en ligne"
                  value={money(reconciliation.data.recordedOnline)}
                />
                <Stat label="Relevé prestataire" value={money(reconciliation.data.provider)} />
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Stat
                  label="Espèces déclarées"
                  className="col-span-2 sm:col-span-1"
                  value={money(reconciliation.data.recordedCash)}
                />
                <Stat label="Transactions rapprochées" value={reconciliation.data.matched} />
                <Stat
                  label="Écarts à vérifier"
                  value={
                    reconciliation.data.providerOnly.length + reconciliation.data.appOnly.length
                  }
                />
              </div>
              {reconciliation.data.providerOnly.length || reconciliation.data.appOnly.length ? (
                <div className="rounded-control bg-warning-bg p-3 text-label text-warning">
                  <strong>Écarts détectés :</strong> {reconciliation.data.providerOnly.length}{' '}
                  encaissement(s) absents de l’application et {reconciliation.data.appOnly.length}{' '}
                  paiement(s) absents du relevé.
                </div>
              ) : (
                <p className="rounded-control bg-green-100 p-3 font-bold text-green-700">
                  Aucun écart pour cette période.
                </p>
              )}
            </>
          ) : null}
        </QueryState>
      </Card>
    </PageFrame>
  );
}

const payoutStageLabels: Record<PayoutRow['stage'], string> = {
  upcoming: 'À venir',
  collecting: 'Collecte en cours',
  ready: 'Prêt à verser',
  blocked: 'Bloqué',
  paid: 'Versé',
};

export function PayoutsPage() {
  const payouts = useQuery({
    queryKey: ['admin', 'payouts'],
    queryFn: () => financeService.payouts(),
  });
  const [blocking, setBlocking] = useState<PayoutRow | null>(null);
  const [reason, setReason] = useState('');
  const [compensationGroupId, setCompensationGroupId] = useState('');
  const [compensationAmount, setCompensationAmount] = useState('');
  const [compensationNote, setCompensationNote] = useState('');
  const earnings = useQuery({
    queryKey: ['admin', 'platform-earnings'],
    queryFn: () => financeService.earnings(),
  });
  const groups = useQuery({
    queryKey: queryKeys.managedGroups,
    queryFn: () => groupService.listManaged(),
  });
  const compensate = useAction({
    action: () =>
      financeService.compensateAdmin(
        compensationGroupId,
        Number(compensationAmount),
        compensationNote,
      ),
    success: 'Rémunération versée à l’administrateur',
    onSuccess: () => {
      setCompensationAmount('');
      setCompensationNote('');
    },
  });
  const creditPlatform = useAction({
    action: (roundId: string) => roundService.payout(roundId),
    success: 'Revenu de la période crédité à la plateforme',
  });
  const selectedIncome =
    earnings.data?.earnings
      .filter((entry) => entry.groupId === compensationGroupId)
      .reduce((sum, entry) => sum + entry.amount, 0) ?? 0;
  const selectedCompensations =
    earnings.data?.compensations
      .filter((entry) => entry.groupId === compensationGroupId)
      .reduce((sum, entry) => sum + entry.amount, 0) ?? 0;
  const selectedBalance = Math.max(0, selectedIncome - selectedCompensations);
  const block = useAction({
    action: ({ row, note }: { row: PayoutRow; note: string }) =>
      financeService.blockPayout(row.round.id, note),
    success: 'Versement bloqué',
    onSuccess: () => {
      setBlocking(null);
      setReason('');
    },
  });
  const unblock = useAction({
    action: (roundId: string) => financeService.unblockPayout(roundId),
    success: 'Versement débloqué',
  });
  const stages = ['ready', 'blocked', 'collecting', 'upcoming', 'paid'] as const;
  const payoutPage = useShowMore(payouts.data ?? [], 15, null);
  return (
    <PageFrame
      title="Versements"
      subtitle="Suivez les cagnottes et bloquez un versement en cas de doute."
    >
      <QueryState query={payouts}>
        <>
          <Card className="flex flex-col gap-4">
            <div>
              <CardTitle>Revenus du Superadmin et rémunération des admins</CardTitle>
              <p className="text-label text-muted">
                Frais d’adhésion, pénalités encaissées et période finale réservée. Les versements à
                l’admin sont facultatifs et plafonnés aux revenus disponibles de son groupe.
              </p>
            </div>
            <QueryState query={earnings}>
              {earnings.data ? (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <Stat
                      label="Disponible"
                      className="col-span-2 sm:order-last sm:col-span-1"
                      value={money(earnings.data.available)}
                    />
                    <Stat label="Revenus encaissés" value={money(earnings.data.earnedTotal)} />
                    <Stat
                      label="Rémunérations admins"
                      value={money(earnings.data.compensatedTotal)}
                    />
                  </div>
                  <form
                    className="grid gap-3 rounded-control border border-line p-4 sm:grid-cols-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      compensate.mutate();
                    }}
                  >
                    <Select
                      label="Groupe et administrateur"
                      value={compensationGroupId}
                      onChange={(event) => setCompensationGroupId(event.target.value)}
                      options={(groups.data ?? []).map(({ group, adminName }) => ({
                        value: group.id,
                        label: `${group.name} — ${adminName}`,
                      }))}
                      placeholder="Choisir un groupe"
                      required
                    />
                    <Input
                      label={`Montant à verser (disponible : ${money(selectedBalance)})`}
                      type="number"
                      min={1}
                      max={selectedBalance}
                      step={1}
                      value={compensationAmount}
                      onChange={(event) => setCompensationAmount(event.target.value)}
                      required
                    />
                    <Textarea
                      label="Motif du versement"
                      value={compensationNote}
                      onChange={(event) => setCompensationNote(event.target.value)}
                      required
                      minLength={3}
                      className="sm:col-span-2"
                    />
                    <Button
                      variant="blue"
                      loading={compensate.isPending}
                      disabled={
                        !compensationGroupId ||
                        !compensationAmount ||
                        Number(compensationAmount) < 1 ||
                        Number(compensationAmount) > selectedBalance ||
                        !compensationNote.trim()
                      }
                      className="sm:col-span-2 sm:justify-self-start"
                    >
                      Verser la rémunération
                    </Button>
                  </form>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div>
                      <p className="mb-2 font-semibold">Revenus enregistrés</p>
                      <ul className="divide-y divide-line text-label">
                        {earnings.data.earnings
                          .slice(-8)
                          .reverse()
                          .map((entry) => (
                            <li key={entry.id} className="flex justify-between gap-3 py-2">
                              <span>
                                {entry.kind === 'membership_fee'
                                  ? 'Frais d’adhésion'
                                  : entry.kind === 'late_penalty'
                                    ? 'Pénalité de retard'
                                    : 'Période finale'}{' '}
                                · {entry.groupName}
                              </span>
                              <strong>{money(entry.amount)}</strong>
                            </li>
                          ))}
                        {!earnings.data.earnings.length ? (
                          <li className="py-2 text-muted">Aucun revenu encaissé pour le moment.</li>
                        ) : null}
                      </ul>
                    </div>
                    <div>
                      <p className="mb-2 font-semibold">Rémunérations versées</p>
                      <ul className="divide-y divide-line text-label">
                        {earnings.data.compensations
                          .slice(-8)
                          .reverse()
                          .map((entry) => (
                            <li key={entry.id} className="flex justify-between gap-3 py-2">
                              <span>
                                {entry.adminName} · {entry.groupName}
                              </span>
                              <strong>{money(entry.amount)}</strong>
                            </li>
                          ))}
                        {!earnings.data.compensations.length ? (
                          <li className="py-2 text-muted">Aucune rémunération versée.</li>
                        ) : null}
                      </ul>
                    </div>
                  </div>
                </>
              ) : null}
            </QueryState>
          </Card>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stages.slice(0, 4).map((stage) => (
              <Stat
                key={stage}
                label={payoutStageLabels[stage]}
                value={(payouts.data ?? []).filter((row) => row.stage === stage).length}
              />
            ))}
          </div>
          <Card className="flex flex-col gap-4">
            <CardTitle>Tous les versements</CardTitle>
            {blocking ? (
              <form
                className="grid gap-3 rounded-control border border-warning/30 bg-warning-bg p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  block.mutate({ row: blocking, note: reason });
                }}
              >
                <p className="font-bold text-warning">
                  Bloquer le tour {blocking.round.number} · {blocking.groupName}
                </p>
                <Textarea
                  label="Motif du blocage"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  required
                  minLength={4}
                />
                <div className="flex gap-2">
                  <Button variant="warning" loading={block.isPending}>
                    Confirmer le blocage
                  </Button>
                  <Button variant="outline" onClick={() => setBlocking(null)}>
                    Annuler
                  </Button>
                </div>
              </form>
            ) : null}
            {(payouts.data ?? []).length ? (
              <div className="flex flex-col divide-y divide-line">
                {payoutPage.visible.map((row) => (
                  <article
                    key={row.round.id}
                    className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong>
                          {row.groupName} ·{' '}
                          {row.round.recipientType === 'platform'
                            ? 'Période Superadmin'
                            : `Tour ${row.round.number}`}
                        </strong>
                        <Badge
                          tone={
                            row.stage === 'paid'
                              ? 'success'
                              : row.stage === 'blocked'
                                ? 'danger'
                                : row.stage === 'ready'
                                  ? 'info'
                                  : 'neutral'
                          }
                        >
                          {payoutStageLabels[row.stage]}
                        </Badge>
                      </div>
                      <p className="text-label text-muted">
                        {row.round.recipientType === 'platform'
                          ? 'Revenu attribué au Superadmin'
                          : `Bénéficiaire(s) : ${
                              row.beneficiaries.length
                                ? row.beneficiaries.map(fullName).join(', ')
                                : fullName(row.beneficiary)
                            }`}{' '}
                        · Admin : {row.adminName}
                      </p>
                      <p className="text-small text-muted">
                        Échéance : {formatDate(row.round.dueDate)} · Collecté {money(row.collected)}{' '}
                        / {money(row.expected)}
                      </p>
                      {row.round.payoutBlockReason ? (
                        <p className="text-small text-danger">
                          Motif : {row.round.payoutBlockReason}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <AmountText
                        value={row.round.potAmount}
                        className="font-bold text-green-700"
                      />
                      {row.round.recipientType === 'platform' && row.stage === 'ready' ? (
                        <Button
                          variant="blue"
                          size="sm"
                          loading={creditPlatform.isPending}
                          onClick={() => creditPlatform.mutate(row.round.id)}
                        >
                          Créditer la plateforme
                        </Button>
                      ) : row.stage === 'blocked' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          loading={unblock.isPending}
                          onClick={() => unblock.mutate(row.round.id)}
                        >
                          Débloquer
                        </Button>
                      ) : row.stage !== 'paid' ? (
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => setBlocking(row)}
                          icon={<Ban className="h-4 w-4" aria-hidden="true" />}
                        >
                          Bloquer
                        </Button>
                      ) : null}
                    </div>
                  </article>
                ))}
                {payoutPage.more ? <div className="pt-4">{payoutPage.more}</div> : null}
              </div>
            ) : (
              <p className="text-muted">Aucun versement disponible.</p>
            )}
          </Card>
        </>
      </QueryState>
    </PageFrame>
  );
}

const disputeStatusLabel = {
  open: 'Ouvert',
  in_progress: 'En cours',
  resolved: 'Résolu',
  rejected: 'Rejeté',
} as const;
const disputeKindLabel = {
  debited_not_recorded: 'Débit non enregistré',
  double_payment: 'Double paiement',
  wrong_amount: 'Montant incorrect',
  other: 'Autre réclamation',
} as const;

export function DisputesPage() {
  const disputes = useQuery({
    queryKey: ['admin', 'disputes'],
    queryFn: () => disputeService.list(),
  });
  const [selected, setSelected] = useState<DisputeView | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [note, setNote] = useState('');
  const take = useAction({
    action: (id: string) => disputeService.take(id),
    success: 'Litige pris en charge',
  });
  const record = useAction({
    action: (id: string) => disputeService.recordPayment(id),
    success: 'Paiement enregistré',
  });
  const refund = useAction({
    action: ({ id, amount, message }: { id: string; amount: number; message: string }) =>
      disputeService.refund(id, amount, message),
    success: 'Remboursement validé',
    onSuccess: () => {
      setSelected(null);
      setNote('');
    },
  });
  const reject = useAction({
    action: ({ id, message }: { id: string; message: string }) =>
      disputeService.reject(id, message),
    success: 'Réclamation rejetée',
    onSuccess: () => {
      setSelected(null);
      setNote('');
    },
  });
  return (
    <PageFrame
      title="Litiges et remboursements"
      subtitle="Examinez les réclamations des membres et tracez chaque décision."
    >
      <QueryState query={disputes}>
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(['open', 'in_progress', 'resolved', 'rejected'] as const).map((status) => (
              <Stat
                key={status}
                label={disputeStatusLabel[status]}
                value={
                  (disputes.data ?? []).filter((item) => item.dispute.status === status).length
                }
              />
            ))}
          </div>
          {selected ? (
            <Card className="flex flex-col gap-4 border-2 border-blue-100">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>Traiter la réclamation de {fullName(selected.user)}</CardTitle>
                  <p className="mt-1 text-label text-muted">
                    {selected.groupName} · {disputeKindLabel[selected.dispute.kind]} ·{' '}
                    {money(selected.dispute.amount)}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setSelected(null)}>
                  Fermer
                </Button>
              </div>
              <p>{selected.dispute.description}</p>
              {selected.dispute.providerRef ? (
                <p className="text-label text-muted">
                  Référence prestataire : {selected.dispute.providerRef}
                </p>
              ) : null}
              <ol className="flex flex-col gap-2 border-l-2 border-line pl-4">
                {selected.history.map((event, index) => (
                  <li key={`${event.at}-${index}`}>
                    <strong>{event.actorName}</strong> · {event.text}
                    <span className="block text-small text-muted">{formatDateTime(event.at)}</span>
                  </li>
                ))}
              </ol>
              {selected.dispute.status === 'open' || selected.dispute.status === 'in_progress' ? (
                <div className="grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
                  <Input
                    label="Montant du remboursement (FCFA)"
                    type="number"
                    min="1"
                    max={selected.dispute.amount}
                    value={refundAmount || selected.dispute.amount}
                    onChange={(event) => setRefundAmount(event.target.value)}
                  />
                  <Textarea
                    label="Message / motif (obligatoire pour rejeter)"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                  <div className="flex flex-wrap gap-2 sm:col-span-2">
                    {selected.dispute.status === 'open' ? (
                      <Button
                        variant="blue"
                        loading={take.isPending}
                        onClick={() => take.mutate(selected.dispute.id)}
                      >
                        Prendre en charge
                      </Button>
                    ) : null}
                    {selected.dispute.kind === 'debited_not_recorded' ? (
                      <Button
                        variant="primary"
                        loading={record.isPending}
                        onClick={() => record.mutate(selected.dispute.id)}
                      >
                        Enregistrer le paiement
                      </Button>
                    ) : null}
                    <Button
                      variant="primary"
                      loading={refund.isPending}
                      disabled={!refundAmount || Number(refundAmount) <= 0}
                      onClick={() =>
                        refund.mutate({
                          id: selected.dispute.id,
                          amount: Number(refundAmount),
                          message: note,
                        })
                      }
                    >
                      Valider le remboursement
                    </Button>
                    <Button
                      variant="danger"
                      loading={reject.isPending}
                      disabled={!note.trim()}
                      onClick={() => reject.mutate({ id: selected.dispute.id, message: note })}
                    >
                      Rejeter
                    </Button>
                  </div>
                </div>
              ) : null}
            </Card>
          ) : null}
          <Card className="flex flex-col gap-3">
            <CardTitle>Réclamations reçues</CardTitle>
            {(disputes.data ?? []).length ? (
              (disputes.data ?? []).map((item) => (
                <button
                  key={item.dispute.id}
                  type="button"
                  onClick={() => {
                    setSelected(item);
                    setRefundAmount(String(item.dispute.amount));
                    setNote('');
                  }}
                  className="flex flex-col gap-1 rounded-control border border-line p-4 text-left transition-colors hover:border-blue-700"
                >
                  <span className="flex flex-wrap items-center gap-2 font-bold">
                    {fullName(item.user)} · {disputeKindLabel[item.dispute.kind]}
                    <Badge
                      tone={
                        item.dispute.status === 'resolved'
                          ? 'success'
                          : item.dispute.status === 'rejected'
                            ? 'danger'
                            : item.dispute.status === 'open'
                              ? 'warning'
                              : 'info'
                      }
                    >
                      {disputeStatusLabel[item.dispute.status]}
                    </Badge>
                  </span>
                  <span className="text-label text-muted">
                    {item.groupName} · {money(item.dispute.amount)} ·{' '}
                    {formatDate(item.dispute.createdAt)}
                  </span>
                  <span className="line-clamp-2 text-label">{item.dispute.description}</span>
                </button>
              ))
            ) : (
              <p className="text-muted">Aucune réclamation enregistrée.</p>
            )}
          </Card>
        </>
      </QueryState>
    </PageFrame>
  );
}

const smsKindLabels = {
  otp: 'Connexion',
  reminder: 'Rappels',
  announcement: 'Annonces',
  payment: 'Paiements',
  payout: 'Versements',
} as const;

export function AnnouncementsPage() {
  const [targetKind, setTargetKind] = useState<'all' | 'admins' | 'group'>('all');
  const [groupId, setGroupId] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [days, setDays] = useState('30');
  const groups = useQuery({
    queryKey: queryKeys.managedGroups,
    queryFn: () => groupService.listManaged(),
  });
  const sms = useQuery({
    queryKey: ['admin', 'sms-stats', days],
    queryFn: () => communicationService.smsStats(Number(days)),
  });
  const send = useAction({
    action: () =>
      communicationService.announce(
        targetKind === 'group' ? { kind: 'group', groupId } : { kind: targetKind },
        title,
        message,
      ),
    success: (count) => `Annonce envoyée à ${count} destinataire${count > 1 ? 's' : ''}`,
    onSuccess: () => {
      setTitle('');
      setMessage('');
    },
  });
  return (
    <PageFrame
      title="Notifications et annonces"
      subtitle="Diffusez un message ciblé et consultez les coûts d’envoi des SMS."
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Card className="flex flex-col gap-4">
          <CardTitle>Nouvelle annonce</CardTitle>
          <Select
            label="Destinataires"
            value={targetKind}
            onChange={(event) => setTargetKind(event.target.value as typeof targetKind)}
            options={[
              { value: 'all', label: 'Toute la plateforme' },
              { value: 'admins', label: 'Tous les administrateurs' },
              { value: 'group', label: 'Membres d’un groupe' },
            ]}
          />
          {targetKind === 'group' ? (
            <Select
              label="Groupe"
              value={groupId}
              onChange={(event) => setGroupId(event.target.value)}
              options={(groups.data ?? []).map(({ group }) => ({
                value: group.id,
                label: group.name,
              }))}
              placeholder="Sélectionner un groupe"
            />
          ) : null}
          <Input
            label="Titre"
            value={title}
            maxLength={100}
            onChange={(event) => setTitle(event.target.value)}
          />
          <Textarea
            label="Message"
            value={message}
            maxLength={500}
            rows={5}
            onChange={(event) => setMessage(event.target.value)}
            hint="Le message sera envoyé dans l’application et par SMS."
          />
          <Button
            icon={<Send className="h-4 w-4" aria-hidden="true" />}
            loading={send.isPending}
            disabled={!title.trim() || !message.trim() || (targetKind === 'group' && !groupId)}
            onClick={() => send.mutate()}
          >
            Envoyer l’annonce
          </Button>
        </Card>
        <Card className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle>Suivi des SMS</CardTitle>
              <p className="mt-1 text-label text-muted">Volume et coût des messages envoyés.</p>
            </div>
            <Select
              label="Période"
              value={days}
              onChange={(event) => setDays(event.target.value)}
              options={[
                { value: '7', label: '7 derniers jours' },
                { value: '30', label: '30 derniers jours' },
                { value: '90', label: '90 derniers jours' },
              ]}
            />
          </div>
          <QueryState query={sms}>
            {sms.data ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="SMS envoyés" value={sms.data.count} />
                  <Stat label="Coût total" value={money(sms.data.cost)} />
                </div>
                <ul className="divide-y divide-line">
                  {sms.data.byKind.map((item) => (
                    <li key={item.kind} className="flex justify-between gap-3 py-2">
                      <span>{smsKindLabels[item.kind]}</span>
                      <span className="text-muted">
                        {item.count} · {money(item.cost)}
                      </span>
                    </li>
                  ))}
                </ul>
                <h3 className="font-bold">Envois récents</h3>
                <ul className="max-h-64 divide-y divide-line overflow-auto">
                  {sms.data.recent.map((item) => (
                    <li key={item.id} className="flex justify-between gap-2 py-2 text-small">
                      <span>
                        {item.name ?? item.phone} · {smsKindLabels[item.kind]}
                      </span>
                      <span className="shrink-0 text-muted">{formatDateTime(item.at)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </QueryState>
        </Card>
      </div>
    </PageFrame>
  );
}

const currentMonth = new Date();
const defaultFrom = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
const defaultTo = format(currentMonth, 'yyyy-MM-dd');

function ReportTable({ title, rows }: { title: string; rows: PlatformReport['byGroup'] }) {
  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>{title}</CardTitle>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-left text-label">
            <thead className="border-b border-line text-small uppercase text-muted">
              <tr>
                <th className="py-2">Nom</th>
                <th>Attendu</th>
                <th>Collecté</th>
                <th>Recouvrement</th>
                <th>Retards</th>
                <th>Versé</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="py-3 font-bold">{row.label}</td>
                  <td>{money(row.expected)}</td>
                  <td>{money(row.collected)}</td>
                  <td>{row.rate === null ? '—' : `${row.rate} %`}</td>
                  <td>{money(row.lateAmount)}</td>
                  <td>{money(row.paidOut)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-muted">Aucune donnée pour cette période.</p>
      )}
    </Card>
  );
}

export function ReportsPage() {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [applied, setApplied] = useState({ from: defaultFrom, to: defaultTo });
  const report = useQuery({
    queryKey: ['admin', 'report', applied.from, applied.to],
    queryFn: () => reportService.report(applied.from, applied.to),
  });
  const exportReport = () => {
    if (!report.data) return;
    const data = report.data;
    downloadCsv(
      [
        ['Période', data.from, data.to],
        [],
        ['Indicateur', 'Valeur'],
        ['Attendu', data.totals.expected],
        ['Collecté', data.totals.collected],
        ['Taux', data.totals.rate ?? '—'],
        ['Retards', data.totals.lateAmount],
        ['Versé', data.totals.paidOut],
        ['Membres', data.totals.members],
        ['Nouveaux membres', data.totals.newMembers],
        [],
        ['Groupe', 'Attendu', 'Collecté', 'Taux', 'Retards', 'Versé'],
        ...data.byGroup.map((row) => [
          row.label,
          row.expected,
          row.collected,
          row.rate ?? '—',
          row.lateAmount,
          row.paidOut,
        ]),
      ],
      `rapport-${applied.from}-${applied.to}.csv`,
    );
  };
  return (
    <PageFrame
      title="Rapports et statistiques"
      subtitle="Bilans de collecte, de recouvrement et d’activité sur une période."
    >
      <Card className="flex flex-wrap items-end gap-3">
        <Input
          label="Du"
          type="date"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
        />
        <Input label="Au" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        <Button
          variant="blue"
          disabled={!from || !to || from > to}
          onClick={() => setApplied({ from, to })}
        >
          Afficher le rapport
        </Button>
        <Button
          variant="outline"
          disabled={!report.data}
          onClick={exportReport}
          icon={<Download className="h-4 w-4" aria-hidden="true" />}
        >
          Exporter CSV
        </Button>
      </Card>
      <QueryState query={report}>
        {report.data ? (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Collecté" value={money(report.data.totals.collected)} />
              <Stat label="Attendu" value={money(report.data.totals.expected)} />
              <Stat
                label="Recouvrement"
                value={report.data.totals.rate === null ? '—' : `${report.data.totals.rate} %`}
              />
              <Stat
                label="Membres · nouveaux"
                value={`${report.data.totals.members} · +${report.data.totals.newMembers}`}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Retards" value={money(report.data.totals.lateAmount)} />
              <Stat label="Versements effectués" value={money(report.data.totals.paidOut)} />
            </div>
            <ReportTable title="Bilan par groupe" rows={report.data.byGroup} />
            <ReportTable title="Bilan par administrateur" rows={report.data.byAdmin} />
            <Card className="flex flex-col gap-3">
              <CardTitle>Évolution mensuelle</CardTitle>
              {report.data.monthly.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[440px] text-left text-label">
                    <thead className="border-b border-line text-small uppercase text-muted">
                      <tr>
                        <th className="py-2">Mois</th>
                        <th>Attendu</th>
                        <th>Collecté</th>
                        <th>Taux</th>
                        <th>Nouveaux membres</th>
                        <th>Total membres</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {report.data.monthly.map((month, index) => {
                        const memberMonth = report.data?.members[index];
                        return (
                          <tr key={month.month}>
                            <td className="py-3 capitalize">
                              {format(new Date(month.month), 'MMMM yyyy', { locale: fr })}
                            </td>
                            <td>{money(month.expected)}</td>
                            <td>{money(month.collected)}</td>
                            <td>
                              {month.expected
                                ? `${Math.round((month.collected / month.expected) * 100)} %`
                                : '—'}
                            </td>
                            <td>{memberMonth?.added ?? 0}</td>
                            <td>{memberMonth?.total ?? 0}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-muted">Aucune donnée mensuelle.</p>
              )}
            </Card>
          </>
        ) : null}
      </QueryState>
    </PageFrame>
  );
}

export function AuditPage() {
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const audit = useQuery({ queryKey: ['admin', 'audit'], queryFn: () => reportService.auditLog() });
  const filtered = (audit.data ?? []).filter(
    ({ entry, actorName }) =>
      (!search ||
        `${actorName} ${entry.summary}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) &&
      (!action || entry.action === action) &&
      (!from || entry.at.slice(0, 10) >= from) &&
      (!to || entry.at.slice(0, 10) <= to),
  );
  return (
    <PageFrame
      title="Journal d’audit"
      subtitle="Historique chronologique des actions sensibles de la plateforme."
    >
      <Card className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            label="Rechercher"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Select
            label="Type d’action"
            value={action}
            onChange={(event) => setAction(event.target.value)}
            options={Array.from(new Set((audit.data ?? []).map(({ entry }) => entry.action))).map(
              (value) => ({ value, label: value.replaceAll('_', ' ') }),
            )}
            placeholder="Toutes les actions"
          />
          <Input
            label="À partir du"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
          <Input
            label="Jusqu’au"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
        <QueryState query={audit}>
          {filtered.length ? (
            <ol className="divide-y divide-line">
              {filtered.map(({ entry, actorName }) => (
                <li key={entry.id} className="flex gap-3 py-4">
                  <span
                    className="mt-2 h-2 w-2 shrink-0 rounded-full bg-blue-700"
                    aria-hidden="true"
                  />
                  <div>
                    <p>
                      <strong>{actorName}</strong> {entry.summary}
                    </p>
                    <time className="text-small text-muted" dateTime={entry.at}>
                      {formatDateTime(entry.at)}
                    </time>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-muted">Aucune action ne correspond aux filtres.</p>
          )}
        </QueryState>
      </Card>
    </PageFrame>
  );
}

function useSaveSettings<K extends keyof PlatformSettings>(section: K) {
  return useAction<PlatformSettings[K]>({
    action: (values) => settingsService.update(section, values),
    success: 'Paramètres enregistrés',
  });
}

export function SettingsPage() {
  const query = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => settingsService.get() });
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  useEffect(() => {
    if (query.data) setSettings(query.data);
  }, [query.data]);
  const savePayment = useSaveSettings('payment');
  const saveRules = useSaveSettings('rules');
  const saveSecurity = useSaveSettings('security');
  const saveSms = useSaveSettings('sms');
  const saveApp = useSaveSettings('app');
  const saveTemplates = useSaveSettings('templates');
  if (!settings) {
    return (
      <PageFrame title="Paramètres" subtitle="Configuration et règles de la plateforme.">
        <QueryState query={query}>{null}</QueryState>
      </PageFrame>
    );
  }
  const updateNumber = <K extends keyof PlatformSettings>(
    section: K,
    key: keyof PlatformSettings[K],
    value: string,
  ) => {
    const numeric = Number(value);
    setSettings((current) =>
      current
        ? {
            ...current,
            [section]: { ...current[section], [key]: Number.isFinite(numeric) ? numeric : 0 },
          }
        : current,
    );
  };
  return (
    <PageFrame title="Paramètres" subtitle="Configuration et règles de la plateforme.">
      <div className="flex items-start gap-3 rounded-control bg-blue-100 p-4 text-blue-900">
        <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <p className="text-label">
          Les clés sont masquées dans les champs. En production, elles doivent être conservées côté
          serveur et ne jamais être exposées au navigateur.
        </p>
      </div>
      <Card className="flex flex-col gap-4">
        <CardTitle>Paiement</CardTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label="Fournisseur"
            value={settings.payment.provider}
            onChange={(event) =>
              setSettings({
                ...settings,
                payment: { ...settings.payment, provider: event.target.value },
              })
            }
          />
          <Select
            label="Mode"
            value={settings.payment.mode}
            onChange={(event) =>
              setSettings({
                ...settings,
                payment: {
                  ...settings.payment,
                  mode: event.target.value as PlatformSettings['payment']['mode'],
                },
              })
            }
            options={[
              { value: 'test', label: 'Test' },
              { value: 'live', label: 'Production' },
            ]}
          />
          <Input
            label="Clé publique"
            type="password"
            autoComplete="new-password"
            value={settings.payment.publicKey}
            onChange={(event) =>
              setSettings({
                ...settings,
                payment: { ...settings.payment, publicKey: event.target.value },
              })
            }
          />
          <Input
            label="Clé secrète"
            type="password"
            autoComplete="new-password"
            value={settings.payment.secretKey}
            onChange={(event) =>
              setSettings({
                ...settings,
                payment: { ...settings.payment, secretKey: event.target.value },
              })
            }
          />
          <Input
            label="Frais (%)"
            type="number"
            min="0"
            step="0.1"
            value={settings.payment.feePercent}
            onChange={(event) => updateNumber('payment', 'feePercent', event.target.value)}
          />
        </div>
        <Button
          variant="blue"
          loading={savePayment.isPending}
          onClick={() => savePayment.mutate(settings.payment)}
        >
          Enregistrer le paiement
        </Button>
      </Card>
      <Card className="flex flex-col gap-4">
        <CardTitle>Règles des tontines</CardTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Input
            label="Délai de grâce (jours)"
            type="number"
            min="0"
            value={settings.rules.graceDays}
            onChange={(event) => updateNumber('rules', 'graceDays', event.target.value)}
          />
          <Input
            label="Pénalité par défaut (FCFA)"
            type="number"
            min="0"
            value={settings.rules.defaultLatePenalty}
            onChange={(event) => updateNumber('rules', 'defaultLatePenalty', event.target.value)}
          />
          <Input
            label="Cotisation minimale (FCFA)"
            type="number"
            min="1"
            value={settings.rules.minContribution}
            onChange={(event) => updateNumber('rules', 'minContribution', event.target.value)}
          />
          <Input
            label="Cotisation maximale (FCFA)"
            type="number"
            min="1"
            value={settings.rules.maxContribution}
            onChange={(event) => updateNumber('rules', 'maxContribution', event.target.value)}
          />
          <Input
            label="Nombre maximal de parts par groupe"
            type="number"
            min="2"
            value={settings.rules.maxMembers}
            onChange={(event) => updateNumber('rules', 'maxMembers', event.target.value)}
          />
        </div>
        <Button
          variant="blue"
          loading={saveRules.isPending}
          onClick={() => saveRules.mutate(settings.rules)}
        >
          Enregistrer les règles
        </Button>
      </Card>
      <Card className="flex flex-col gap-4">
        <CardTitle>Connexion et sécurité</CardTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Input
            label="Validité du code SMS (minutes)"
            type="number"
            min="1"
            value={settings.security.otpValidityMinutes}
            onChange={(event) => updateNumber('security', 'otpValidityMinutes', event.target.value)}
          />
          <Input
            label="Essais PIN autorisés"
            type="number"
            min="1"
            value={settings.security.maxPinAttempts}
            onChange={(event) => updateNumber('security', 'maxPinAttempts', event.target.value)}
          />
          <Input
            label="Verrouillage après inactivité (minutes)"
            type="number"
            min="1"
            value={settings.security.inactivityLockMinutes}
            onChange={(event) =>
              updateNumber('security', 'inactivityLockMinutes', event.target.value)
            }
          />
        </div>
        <Button
          variant="blue"
          loading={saveSecurity.isPending}
          onClick={() => saveSecurity.mutate(settings.security)}
        >
          Enregistrer la sécurité
        </Button>
      </Card>
      <Card className="flex flex-col gap-4">
        <CardTitle>Fournisseur SMS</CardTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label="Fournisseur"
            value={settings.sms.provider}
            onChange={(event) =>
              setSettings({ ...settings, sms: { ...settings.sms, provider: event.target.value } })
            }
          />
          <Input
            label="Nom de l’expéditeur"
            maxLength={11}
            value={settings.sms.senderName}
            onChange={(event) =>
              setSettings({ ...settings, sms: { ...settings.sms, senderName: event.target.value } })
            }
          />
          <Input
            label="Clé API"
            type="password"
            autoComplete="new-password"
            value={settings.sms.apiKey}
            onChange={(event) =>
              setSettings({ ...settings, sms: { ...settings.sms, apiKey: event.target.value } })
            }
          />
          <Input
            label="Coût par SMS (FCFA)"
            type="number"
            min="0"
            value={settings.sms.costPerSms}
            onChange={(event) => updateNumber('sms', 'costPerSms', event.target.value)}
          />
        </div>
        <Button
          variant="blue"
          loading={saveSms.isPending}
          onClick={() => saveSms.mutate(settings.sms)}
        >
          Enregistrer le fournisseur
        </Button>
      </Card>
      <Card className="flex flex-col gap-4">
        <CardTitle>Application et assistance</CardTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label="Nom de l’application"
            value={settings.app.name}
            onChange={(event) =>
              setSettings({ ...settings, app: { ...settings.app, name: event.target.value } })
            }
          />
          <Input
            label="Téléphone du support"
            value={settings.app.supportPhone}
            onChange={(event) =>
              setSettings({
                ...settings,
                app: { ...settings.app, supportPhone: event.target.value },
              })
            }
          />
          <Textarea
            label="Conditions d’utilisation"
            rows={4}
            value={settings.app.termsText}
            onChange={(event) =>
              setSettings({ ...settings, app: { ...settings.app, termsText: event.target.value } })
            }
          />
          <Textarea
            label="Politique de confidentialité"
            rows={4}
            value={settings.app.privacyText}
            onChange={(event) =>
              setSettings({
                ...settings,
                app: { ...settings.app, privacyText: event.target.value },
              })
            }
          />
        </div>
        <Button
          variant="blue"
          loading={saveApp.isPending}
          onClick={() => saveApp.mutate(settings.app)}
        >
          Enregistrer l’application
        </Button>
      </Card>
      <Card className="flex flex-col gap-4">
        <CardTitle>Modèles de messages</CardTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(Object.keys(settings.templates) as Array<keyof PlatformSettings['templates']>).map(
            (key) => (
              <Textarea
                key={key}
                label={
                  {
                    reminder: 'Rappel avant échéance',
                    late: 'Relance de retard',
                    payment: 'Confirmation de paiement',
                    payout: 'Avis de versement',
                  }[key]
                }
                rows={3}
                value={settings.templates[key]}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    templates: { ...settings.templates, [key]: event.target.value },
                  })
                }
              />
            ),
          )}
        </div>
        <Button
          variant="blue"
          loading={saveTemplates.isPending}
          onClick={() => saveTemplates.mutate(settings.templates)}
        >
          Enregistrer les modèles
        </Button>
      </Card>
    </PageFrame>
  );
}
