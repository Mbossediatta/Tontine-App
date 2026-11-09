import { useState } from 'react';
import { OnlineButton } from '@/components/layout/OnlineButton';
import { RoundTimeline } from '@/components/domain';
import { AsyncContent, EmptyState } from '@/components/ui';
import { useCurrentUser } from '@/hooks/useAuth';
import type { RoundView } from '@/types';
import { useRounds, useSwaps } from '../queries';
import { SwapList } from '../SwapList';
import { SwapRequestDialog } from '../SwapRequestDialog';

export function CalendarTab({ groupId, cycleActive }: { groupId: string; cycleActive: boolean }) {
  const user = useCurrentUser();
  const query = useRounds(groupId);
  const swaps = useSwaps(groupId, cycleActive);
  const [target, setTarget] = useState<RoundView | null>(null);
  return (
    <AsyncContent query={query}>
      {(rounds) => {
        if (rounds.length === 0) {
          return (
            <EmptyState
              title="Calendrier pas encore fixé"
              description="Le calendrier apparaîtra au démarrage du cycle."
            />
          );
        }
        // Seuls des tours à venir s'échangent, entre membres, pendant le cycle.
        const swappable = (view: RoundView) =>
          cycleActive &&
          view.round.status === 'upcoming' &&
          view.round.recipientType !== 'platform';
        const myRounds = rounds.filter(
          (view) => swappable(view) && view.beneficiaries.some((person) => person.id === user.id),
        );
        return (
          <div className="flex flex-col gap-3">
            <SwapList swaps={swaps.data ?? []} myUserId={user.id} mode="member" />
            <RoundTimeline
              rounds={rounds}
              myUserId={user.id}
              renderAction={(view) =>
                // Tour à venir entre membres (jamais celui de la plateforme), j'ai un autre
                // tour à céder, et c'est le tour d'un autre : anonyme (aucun nom reçu) si je
                // ne gère pas le groupe, ou dont je ne suis pas le seul bénéficiaire.
                swappable(view) &&
                myRounds.some((mine) => mine.round.id !== view.round.id) &&
                (view.beneficiaries.length === 0 ||
                  !view.beneficiaries.every((person) => person.id === user.id)) ? (
                  <OnlineButton size="sm" variant="ghost" onClick={() => setTarget(view)}>
                    Proposer un échange
                  </OnlineButton>
                ) : null
              }
            />
            {target ? (
              <SwapRequestDialog
                key={target.round.id}
                target={target}
                myRounds={myRounds}
                myUserId={user.id}
                onClose={() => setTarget(null)}
              />
            ) : null}
          </div>
        );
      }}
    </AsyncContent>
  );
}
