import { useState } from 'react';
import { Banknote } from 'lucide-react';
import { AmountText, RoundProgress, RoundTimeline } from '@/components/domain';
import { formatDateTime } from '@/lib/format';
import { payoutOpen } from '@/lib/tontine';
import { OnlineButton } from '@/components/layout/OnlineButton';
import { AsyncContent, Card, CardTitle } from '@/components/ui';
import { useRounds, useSwaps } from '@/features/groups/queries';
import { SwapList } from '@/features/groups/SwapList';
import { TransfersCard } from './TransfersCard';
import { useCurrentUser } from '@/hooks/useAuth';
import type { GroupOverview, RoundView } from '@/types';
import { OrderSection } from './OrderSection';
import { PayoutDialog } from './PayoutDialog';

export function RoundsTab({ overview }: { overview: GroupOverview }) {
  const user = useCurrentUser();
  const query = useRounds(overview.group.id);
  const [payoutRound, setPayoutRound] = useState<RoundView | null>(null);
  const swaps = useSwaps(overview.group.id, overview.group.status === 'active');

  if (overview.group.status === 'draft') return <OrderSection overview={overview} />;

  return (
    <AsyncContent query={query}>
      {(rounds) => {
        const current = rounds.find(
          (r) => r.round.status === 'open' || r.round.status === 'ready_for_payout',
        );
        return (
          <div className="flex flex-col gap-3">
            {current ? (
              <Card className="flex flex-col gap-3">
                <CardTitle>
                  {current.round.recipientType === 'platform'
                    ? 'Période réservée au Superadmin'
                    : `Tour ${current.round.number} en cours`}
                </CardTitle>
                <RoundProgress paid={current.paidCount} total={overview.activeShareCount} />
                <p className="text-label text-muted">
                  Cagnotte :{' '}
                  <AmountText value={current.round.potAmount} className="font-semibold text-ink" />
                </p>
                {current.round.recipientType === 'platform' ? (
                  <p className="text-label text-muted">
                    Une fois toutes les cotisations reçues, le Superadmin pourra créditer cette
                    période dans l’espace de supervision.
                  </p>
                ) : (
                  <OnlineButton
                    variant="primary"
                    block
                    disabled={!payoutOpen(current) || Boolean(current.round.payoutRequestedAt)}
                    onClick={() => setPayoutRound(current)}
                    icon={<Banknote className="h-5 w-5" aria-hidden="true" />}
                  >
                    Reverser la cagnotte
                  </OnlineButton>
                )}
                {current.round.payoutRequestedAt ? (
                  <p className="text-label text-blue-700">
                    En attente de la validation du super admin (cagnotte de 300 000 FCFA ou plus).
                  </p>
                ) : null}
                {current.round.status !== 'ready_for_payout' ? (
                  <p className="text-label text-muted">
                    {payoutOpen(current)
                      ? 'Heure limite passée : vous pouvez verser ce qui a été collecté ; les impayés deviendront des dettes.'
                      : `Disponible quand tous les membres auront payé, ou après l’heure limite (${formatDateTime(current.deadline)}).`}
                  </p>
                ) : null}
              </Card>
            ) : null}
            <TransfersCard rounds={rounds} />
            <SwapList swaps={swaps.data ?? []} myUserId={user.id} mode="admin" />
            <RoundTimeline rounds={rounds} myUserId={user.id} />
            <PayoutDialog round={payoutRound} onClose={() => setPayoutRound(null)} />
          </div>
        );
      }}
    </AsyncContent>
  );
}
