import { useState, type ReactNode } from 'react';
import { Play } from 'lucide-react';
import { AmountText, CycleProgress, RoundProgress } from '@/components/domain';
import { OnlineButton } from '@/components/layout/OnlineButton';
import { Card, ConfirmDialog } from '@/components/ui';
import { formatDate, fullName } from '@/lib/format';
import { useAction } from '@/lib/query';
import { groupService } from '@/services';
import type { GroupOverview } from '@/types';
import { InviteShare } from '../components/InviteShare';
import { GROUP_STATUS_LABELS } from './labels';
import { RestartCycleCard } from './RestartCycleCard';

interface OverviewTabProps {
  overview: GroupOverview;
  onGoTo: (tab: 'membres' | 'tours') => void;
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-label text-muted">{label}</dt>
      <dd className="font-semibold text-ink">{children}</dd>
    </div>
  );
}

export function OverviewTab({ overview, onGoTo }: OverviewTabProps) {
  const { group, currentRound, currentBeneficiary, activeShareCount, orderIsSet } = overview;
  const [confirm, setConfirm] = useState(false);
  const start = useAction({
    action: () => groupService.start(group.id),
    success: 'Cycle démarré : le premier tour est ouvert',
    onSuccess: () => setConfirm(false),
  });

  const isFull = activeShareCount === group.maxMembers;
  const canStart = group.status === 'draft' && isFull && orderIsSet;

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <dl className="grid grid-cols-2 gap-4">
          <Stat label="Statut">
            {GROUP_STATUS_LABELS[group.status]} · cycle {group.currentCycle}
          </Stat>
          <Stat label="Membres">
            <span className="tabular-nums">
              {overview.activeMemberCount} personne(s) · {activeShareCount}/{group.maxMembers} parts
            </span>
          </Stat>
          <Stat label="Tour en cours">{currentRound ? `Tour ${currentRound.number}` : '—'}</Stat>
          <Stat label="Total collecté">
            <AmountText value={overview.totalCollected} />
          </Stat>
          <Stat label="Bénéficiaire actuel">
            {currentBeneficiary ? fullName(currentBeneficiary) : '—'}
          </Stat>
          <Stat label="Date limite">{currentRound ? formatDate(currentRound.dueDate) : '—'}</Stat>
        </dl>
      </Card>

      {currentRound ? (
        <Card className="flex flex-col gap-3">
          <CycleProgress current={currentRound.number} total={overview.totalRounds} />
          <RoundProgress paid={overview.paidCount} total={activeShareCount} />
        </Card>
      ) : null}

      {group.status === 'finished' ? <RestartCycleCard group={group} /> : null}

      {group.status === 'draft' ? (
        <>
          <Card tone="info" className="flex flex-col gap-3">
            <p className="font-semibold text-ink">Avant de démarrer</p>
            <ul className="flex flex-col gap-1 text-label text-ink">
              <li>
                {isFull ? '✓' : '•'} Toutes les parts attribuées ({activeShareCount} /{' '}
                {group.maxMembers}){' '}
                {!isFull ? (
                  <button
                    type="button"
                    className="text-blue-700 underline"
                    onClick={() => onGoTo('membres')}
                  >
                    gérer les membres
                  </button>
                ) : null}
              </li>
              <li>
                {orderIsSet ? '✓' : '•'} Ordre des bénéficiaires fixé{' '}
                {!orderIsSet ? (
                  <button
                    type="button"
                    className="text-blue-700 underline"
                    onClick={() => onGoTo('tours')}
                  >
                    fixer l’ordre
                  </button>
                ) : null}
              </li>
            </ul>
            <OnlineButton
              block
              disabled={!canStart}
              onClick={() => setConfirm(true)}
              icon={<Play className="h-5 w-5" aria-hidden="true" />}
            >
              Démarrer le cycle
            </OnlineButton>
          </Card>
          <InviteShare code={group.inviteCode} groupName={group.name} />
        </>
      ) : null}

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => start.mutate()}
        loading={start.isPending}
        title="Démarrer le cycle ?"
        confirmLabel="Démarrer"
      >
        Le premier tour sera ouvert et les membres seront invités à payer. Le montant, la fréquence
        et le nombre de membres ne pourront plus être modifiés.
      </ConfirmDialog>
    </div>
  );
}
