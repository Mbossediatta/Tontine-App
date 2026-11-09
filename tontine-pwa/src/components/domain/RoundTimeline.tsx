import type { ReactNode } from 'react';
import { CheckCircle2, Circle, CircleDot } from 'lucide-react';
import { Badge } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatDate, fullName } from '@/lib/format';
import type { RoundView } from '@/types';
import { AmountText } from './AmountText';
import { StatusBadge } from './StatusBadge';

interface RoundTimelineProps {
  rounds: RoundView[];
  myUserId: string;
  /** Action facultative affichée sur un tour (ex. demander un échange). */
  renderAction?: (view: RoundView) => ReactNode;
}

/** Calendrier vertical des tours ; mon tour est mis en évidence en bleu clair. */
export function RoundTimeline({ rounds, myUserId, renderAction }: RoundTimelineProps) {
  return (
    <ol className="flex flex-col">
      {rounds.map((view, index) => {
        const { round, beneficiary } = view;
        const mine =
          round.recipientType !== 'platform' &&
          (view.beneficiaries.length
            ? view.beneficiaries.some((person) => person.id === myUserId)
            : round.beneficiaryId === myUserId);
        const past = round.status === 'paid_out';
        const current = round.status === 'open' || round.status === 'ready_for_payout';
        const Icon = past ? CheckCircle2 : current ? CircleDot : Circle;
        return (
          <li key={round.id} className="relative flex gap-3 pb-3">
            {index < rounds.length - 1 ? (
              <span
                className="absolute left-[11px] top-9 h-full w-0.5 bg-line"
                aria-hidden="true"
              />
            ) : null}
            <Icon
              className={cn(
                'relative mt-4 h-6 w-6 shrink-0 rounded-full bg-blue-50',
                past ? 'text-green-600' : current ? 'text-blue-700' : 'text-muted',
              )}
              aria-hidden="true"
            />
            <div
              className={cn(
                'flex flex-1 flex-wrap items-center justify-between gap-2 rounded-card p-4',
                mine ? 'bg-blue-100' : 'bg-white shadow-card',
              )}
            >
              <div>
                <p className="font-bold text-ink">
                  Tour {round.number} · {formatDate(round.dueDate)}
                </p>
                <p className="text-label text-muted">
                  {round.recipientType === 'platform'
                    ? 'Période réservée au Superadmin'
                    : mine && view.beneficiaryShares.length <= 1
                      ? 'Vous'
                      : view.beneficiaries.length > 1
                        ? view.beneficiaries.map(fullName).join(' · ')
                        : fullName(beneficiary)}
                  {round.beneficiaryShareCount && round.beneficiaryShareCount > 1
                    ? ` · part ${round.beneficiaryShareNumber}`
                    : ''}{' '}
                  {round.recipientType !== 'platform' || round.potAmount > 0 ? (
                    <>
                      {' '}
                      · <AmountText value={round.potAmount} />
                    </>
                  ) : null}
                </p>
                {/* Plusieurs bénéficiaires : ce que chacun reçoit (une personne qui a deux
                    parts du tour reçoit deux parts). */}
                {round.recipientType !== 'platform' && view.beneficiaryShares.length > 1 ? (
                  <ul className="mt-1 flex flex-col gap-0.5 text-label text-ink">
                    {view.beneficiaryShares.map((share) => (
                      <li key={share.user.id}>
                        {share.user.id === myUserId ? 'Vous' : fullName(share.user)}
                        {share.shareCount > 1 ? ` (${share.shareCount} parts)` : ''} :{' '}
                        <AmountText value={share.amount} className="font-bold" />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {mine ? <StatusBadge status="my_turn" /> : null}
                {past ? (
                  <Badge tone="success">Passé</Badge>
                ) : current ? (
                  <Badge tone="info">En cours</Badge>
                ) : (
                  <Badge tone="neutral">À venir</Badge>
                )}
              </div>
              {renderAction ? renderAction(view) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
