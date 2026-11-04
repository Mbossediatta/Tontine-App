import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Ban } from 'lucide-react';
import { AmountText } from '@/components/domain';
import { Badge, Button, Card, CardTitle, Textarea } from '@/components/ui';
import { formatDate, fullName } from '@/lib/format';
import { useAction } from '@/lib/query';
import { financeService, roundService } from '@/services';
import type { PayoutRow } from '@/types';
import { useShowMore } from '../components/useShowMore';
import { EarningsCard } from './EarningsCard';
import { PageFrame, QueryState, Stat } from './PlatformUi';
import { money } from './labels';

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
  const creditPlatform = useAction({
    action: (roundId: string) => roundService.payout(roundId),
    success: 'Revenu de la période crédité à la plateforme',
  });
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
          <EarningsCard />
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
