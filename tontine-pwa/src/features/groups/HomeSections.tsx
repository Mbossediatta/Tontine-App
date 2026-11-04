import { CalendarClock, CheckCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AmountText, PayButton, StatusBadge } from '@/components/domain';
import { Card, Logo, SectionTitle } from '@/components/ui';
import { formatDate, formatRelative } from '@/lib/format';
import type { GroupOverview } from '@/types';

function dueGroups(groups: GroupOverview[]): GroupOverview[] {
  return groups
    .filter((g) => g.currentRound?.status === 'open' && g.myStatus && g.myStatus !== 'paid')
    .sort((a, b) => (a.currentRound?.dueDate ?? '').localeCompare(b.currentRound?.dueDate ?? ''));
}

/** Carte cagnotte vert clair : total à payer et prochaine date limite. */
export function SummaryCard({ groups }: { groups: GroupOverview[] }) {
  const due = dueGroups(groups);
  const total = due.reduce((sum, g) => sum + g.myAmountDue, 0);
  const next = due[0]?.currentRound;
  return (
    <Card tone="pot" className="relative flex flex-col gap-1 overflow-hidden pr-28">
      <p className="text-label text-ink">À payer ce mois-ci</p>
      <AmountText value={total} tone="due" size="main" />
      {next ? (
        <p className="flex items-center gap-1 text-label text-ink">
          <CalendarClock className="h-4 w-4" aria-hidden="true" />
          Prochaine date : {formatDate(next.dueDate)} ({formatRelative(next.dueDate)})
        </p>
      ) : (
        <p className="flex items-center gap-1 text-label text-ink">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          Vous êtes à jour dans tous vos groupes.
        </p>
      )}
      <Logo size={96} decorative className="absolute -right-2 bottom-2" />
    </Card>
  );
}

/** Liste « À payer » : une carte par groupe avec bouton Payer vert. */
export function DueList({ groups }: { groups: GroupOverview[] }) {
  const navigate = useNavigate();
  const due = dueGroups(groups);
  if (due.length === 0) return null;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="due-title">
      <SectionTitle id="due-title">À payer</SectionTitle>
      {due.map(({ group, currentRound, myStatus, myAmountDue }) => (
        <Card key={group.id} className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-card-title text-ink">{group.name}</p>
              <p className="text-label text-muted">
                <AmountText value={myAmountDue} /> · avant le{' '}
                {currentRound ? formatDate(currentRound.dueDate) : '—'}
              </p>
            </div>
            {myStatus ? <StatusBadge status={myStatus} /> : null}
          </div>
          <PayButton amount={myAmountDue} onClick={() => navigate(`/groupes/${group.id}/payer`)} />
        </Card>
      ))}
    </section>
  );
}

/** Carte « Mon prochain tour ». */
export function NextTurnCard({ groups }: { groups: GroupOverview[] }) {
  const next = groups
    .filter((g) => g.myTurn)
    .sort((a, b) => (a.myTurn?.dueDate ?? '').localeCompare(b.myTurn?.dueDate ?? ''))[0];
  if (!next?.myTurn) return null;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="turn-title">
      <SectionTitle id="turn-title">Mon prochain tour</SectionTitle>
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-card-title text-ink">
            {formatDate(next.myTurn.dueDate)} –{' '}
            <AmountText value={next.myTurn.potAmount} tone="received" />
          </p>
          <p className="text-label text-muted">
            {next.group.name} · tour {next.myTurn.number}
          </p>
        </div>
        <StatusBadge status="my_turn" />
      </Card>
    </section>
  );
}
