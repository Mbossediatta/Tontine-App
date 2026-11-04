import { useState } from 'react';
import { Dices } from 'lucide-react';
import { OnlineButton } from '@/components/layout/OnlineButton';
import { AsyncContent, Button, Card, CardTitle, Modal } from '@/components/ui';
import { useMembers } from '@/features/groups/queries';
import { fullName } from '@/lib/format';
import { useAction } from '@/lib/query';
import { roundService } from '@/services';
import type { GroupOverview, MemberView } from '@/types';
import { DrawAnimation } from '../components/DrawAnimation';
import { ManualOrderEditor } from './ManualOrderEditor';

/** Ordre des bénéficiaires avant le démarrage : tirage au sort ou ordre manuel. */
export function OrderSection({ overview }: { overview: GroupOverview }) {
  const { group, activeShareCount, orderIsSet } = overview;
  const query = useMembers(group.id);
  const [drawOpen, setDrawOpen] = useState(false);
  const [result, setResult] = useState<MemberView[] | null>(null);
  const draw = useAction({
    action: () => roundService.drawOrder(group.id),
    onSuccess: setResult,
  });
  const isFull = activeShareCount === group.maxMembers;

  const startDraw = () => {
    setResult(null);
    setDrawOpen(true);
    draw.mutate(undefined, { onError: () => setDrawOpen(false) });
  };

  return (
    <AsyncContent query={query}>
      {(members) => {
        const active = members.filter((m) => m.membership.status === 'active');
        return (
          <div className="flex flex-col gap-3">
            {group.attributionMode === 'random' ? (
              <Card className="flex flex-col gap-3">
                <CardTitle>Tirage au sort</CardTitle>
                <p className="text-label text-muted">
                  {isFull
                    ? 'Le groupe est complet : lancez le tirage. Le résultat sera visible de tous les membres.'
                    : `Le tirage sera possible quand toutes les parts seront attribuées (${activeShareCount} / ${group.maxMembers}).`}
                </p>
                <OnlineButton
                  block
                  disabled={!isFull}
                  onClick={startDraw}
                  icon={<Dices className="h-5 w-5" aria-hidden="true" />}
                >
                  {orderIsSet ? 'Refaire le tirage' : 'Lancer le tirage au sort'}
                </OnlineButton>
                {orderIsSet ? (
                  <ol className="flex flex-col gap-1 text-ink">
                    {active.map((m) => (
                      <li key={m.membership.id} className="tabular-nums">
                        {m.membership.payoutOrder}. {fullName(m.user)}
                      </li>
                    ))}
                  </ol>
                ) : null}
              </Card>
            ) : (
              <ManualOrderEditor
                key={active
                  .map((m) => `${m.membership.id}:${m.membership.payoutOrder ?? ''}`)
                  .join()}
                groupId={group.id}
                members={active}
              />
            )}
            <Modal
              open={drawOpen}
              onClose={() => setDrawOpen(false)}
              title="Tirage au sort"
              footer={
                result ? <Button onClick={() => setDrawOpen(false)}>Fermer</Button> : undefined
              }
            >
              <DrawAnimation names={active.map((m) => fullName(m.user))} result={result} />
            </Modal>
          </div>
        );
      }}
    </AsyncContent>
  );
}
