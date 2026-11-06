import { useState } from 'react';
import { BellRing } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Link } from 'react-router-dom';
import { AmountText, StatusBadge } from '@/components/domain';
import { OnlineButton } from '@/components/layout/OnlineButton';
import { AsyncContent, Card, ConfirmDialog, Skeleton } from '@/components/ui';
import { formatAmount, fullName, groupContributionLabel, plural } from '@/lib/format';
import { useAction } from '@/lib/query';
import { paymentService } from '@/services';
import type { GroupOverview, RoundPaymentRow } from '@/types';
import { rowActionClass } from '../components/linkStyles';
import { useRoundPayments } from '../queries';

/**
 * Colonnes sur écran large : membre · montant (date dessous) · statut · actions.
 * Statut et actions ont une largeur fixe pour que l'en-tête et les lignes
 * (deux grilles distinctes) restent alignés.
 */
const COLUMNS = 'md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_120px_236px]';

const shortDate = (iso: string) => format(new Date(iso), 'dd MMM', { locale: fr });

/** Montant qu'un membre doit (ou a payé) sur le tour : cotisation + pénalité éventuelle. */
function rowAmount(row: RoundPaymentRow, contribution: number): number {
  return row.status === 'paid' && row.payment
    ? row.payment.amount
    : contribution * row.shareCount + row.penalty;
}

/**
 * « Cotisations du mois » d'un groupe : progression de la collecte, puis une ligne par
 * membre avec son statut. Pour un membre qui n'a pas payé : « Relancer » (rappel par
 * notification) et « Espèces reçues » (paiement remis en main propre à l'admin).
 */
export function ContributionsCard({ overview }: { overview: GroupOverview }) {
  const { group, currentRound: round } = overview;
  const payments = useRoundPayments(round?.id);
  // Membre dont l'admin confirme avoir reçu les espèces.
  const [cashFor, setCashFor] = useState<RoundPaymentRow | null>(null);

  const remindAll = useAction({
    action: () => paymentService.remindLate(round?.id ?? ''),
    success: (count: number) =>
      count > 0 ? `${plural(count, 'membre relancé', 'membres relancés')}` : 'Tout le monde a payé',
  });
  const remindOne = useAction({
    action: (userId: string) => paymentService.remindMember(round?.id ?? '', userId),
    success: 'Rappel envoyé',
  });
  const cash = useAction({
    action: (userId: string) => paymentService.recordCash(round?.id ?? '', userId),
    success: 'Paiement en espèces enregistré',
    onSuccess: () => setCashFor(null),
  });

  // Groupe pas encore démarré (ou suspendu) : pas de tour, donc rien à encaisser.
  if (!round) {
    return (
      <Card className="flex flex-col items-start gap-3">
        <h2 className="text-card-title text-ink">{group.name}</h2>
        <p className="text-muted">
          {group.status === 'draft'
            ? `Le groupe n’a pas encore démarré (${plural(overview.activeMemberCount, 'personne')} · ${overview.activeShareCount}/${group.maxMembers} parts). Les cotisations apparaîtront ici dès le premier tour.`
            : 'Aucun tour en cours pour ce groupe.'}
        </p>
        <Link to={`/admin/groupes/${group.id}`} className="font-bold text-blue-700 underline">
          Gérer le groupe
        </Link>
      </Card>
    );
  }

  const isOpen = round.status === 'open';
  const month = format(new Date(round.dueDate), 'MMMM', { locale: fr });

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-card-title text-ink">
            Cotisations de {month} — {group.name}
          </h2>
          <p className="text-label text-muted">
            {plural(overview.activeMemberCount, 'personne')} · {overview.activeShareCount} parts ·{' '}
            {groupContributionLabel(group)} · période {round.number} sur {overview.totalRounds}
          </p>
        </div>
        {isOpen ? (
          <OnlineButton
            variant="warning"
            size="sm"
            block
            loading={remindAll.isPending}
            onClick={() => remindAll.mutate()}
            icon={<BellRing className="h-4 w-4" aria-hidden="true" />}
          >
            Relancer les retardataires
          </OnlineButton>
        ) : null}
      </div>

      <AsyncContent query={payments} skeleton={<Skeleton className="h-64 rounded-card" />}>
        {(rows) => {
          const collected = rows
            .filter((r) => r.status === 'paid')
            .reduce((sum, r) => sum + rowAmount(r, group.contributionAmount), 0);
          const expected = rows.reduce((sum, r) => sum + rowAmount(r, group.contributionAmount), 0);
          const percent = expected > 0 ? Math.min(100, (collected / expected) * 100) : 0;
          return (
            <>
              {/* Progression de la collecte du tour */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-bold tabular-nums text-ink">
                    {formatAmount(collected)} collectés
                  </span>
                  <span className="text-label tabular-nums text-muted">
                    sur {formatAmount(expected)}
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-label="Collecte du tour"
                  aria-valuemin={0}
                  aria-valuemax={expected}
                  aria-valuenow={collected}
                  className="h-2 overflow-hidden rounded-pill bg-blue-100"
                >
                  <div
                    className="h-full rounded-pill bg-green-600 transition-all duration-250"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>

              <div>
                <div
                  className={`hidden gap-3 border-b border-line px-2 pb-2 text-small uppercase tracking-wide text-muted md:grid ${COLUMNS}`}
                  aria-hidden="true"
                >
                  <span>Membre</span>
                  <span>Montant</span>
                  <span>Statut</span>
                  <span>Action</span>
                </div>
                <ul className="divide-y divide-line">
                  {rows.map((row) => {
                    const paid = row.status === 'paid';
                    return (
                      // Mobile : nom + statut, puis montant et date, puis actions.
                      // Écran large : ordre des colonnes (md:order-*).
                      <li
                        key={row.user.id}
                        className={`grid grid-cols-2 items-center gap-x-3 gap-y-1 px-2 py-3 ${COLUMNS}`}
                      >
                        <span className="truncate font-bold text-ink md:order-1">
                          {fullName(row.user)}
                        </span>
                        {row.shareCount > 1 ? (
                          <span className="text-small text-muted">{row.shareCount} parts</span>
                        ) : null}
                        <span className="justify-self-end md:order-3 md:justify-self-auto">
                          <StatusBadge status={row.status} />
                        </span>
                        {/* Montant, avec la date de paiement (ou l'échéance) en dessous. */}
                        <span className="col-span-2 flex flex-col md:order-2 md:col-span-1">
                          <AmountText
                            value={rowAmount(row, group.contributionAmount)}
                            className="whitespace-nowrap tabular-nums text-ink"
                          />
                          <span className="whitespace-nowrap text-small text-muted">
                            {paid && row.payment?.paidAt
                              ? `Payé le ${shortDate(row.payment.paidAt)}`
                              : `Échéance ${shortDate(round.dueDate)}`}
                          </span>
                        </span>
                        <span className="col-span-2 flex gap-2 pt-1 md:order-4 md:col-span-1 md:pt-0">
                          {paid ? (
                            <span className="text-label text-muted">Reçu envoyé</span>
                          ) : isOpen ? (
                            <>
                              <OnlineButton
                                variant="outline"
                                size="sm"
                                className={rowActionClass}
                                loading={remindOne.isPending && remindOne.variables === row.user.id}
                                onClick={() => remindOne.mutate(row.user.id)}
                              >
                                Relancer
                              </OnlineButton>
                              <OnlineButton
                                variant="outline"
                                size="sm"
                                className={rowActionClass}
                                onClick={() => setCashFor(row)}
                              >
                                Espèces reçues
                              </OnlineButton>
                            </>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </>
          );
        }}
      </AsyncContent>

      <ConfirmDialog
        open={cashFor !== null}
        onClose={() => setCashFor(null)}
        onConfirm={() => cashFor && cash.mutate(cashFor.user.id)}
        loading={cash.isPending}
        tone="primary"
        title="Enregistrer un paiement en espèces ?"
        confirmLabel="Confirmer la réception"
      >
        {cashFor ? (
          <p>
            Vous confirmez avoir reçu{' '}
            <strong>{formatAmount(rowAmount(cashFor, group.contributionAmount))}</strong> en main
            propre de {fullName(cashFor.user)}. Un reçu lui sera envoyé.
          </p>
        ) : null}
      </ConfirmDialog>
    </Card>
  );
}
