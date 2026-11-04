import { ChevronLeft } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useGroup, useMembers, useRounds } from '@/features/groups/queries';
import { useCurrentUser } from '@/hooks/useAuth';
import { cn } from '@/lib/cn';
import { contributionLabel, frequencyLabel, fullName, initials, plural } from '@/lib/format';
import type { GroupOverview, MemberView, RoundView } from '@/types';
import { duesOf, monthName, shortDate } from '../dues';
import { AmountDisplay } from '../ui/AmountDisplay';
import { Button } from '../ui/Button';
import { Card, SectionHeader } from '../ui/Card';
import { EmptyState, ErrorBlock } from '../ui/EmptyState';
import { ListSkeleton, Skeleton } from '../ui/Skeleton';
import { StatusPill } from '../ui/StatusPill';

/** Fiche du groupe en tableau compact : libellé à gauche, valeur à droite. */
function GroupFacts({ overview, admins }: { overview: GroupOverview; admins: string[] }) {
  const { group } = overview;
  const rows: Array<[string, React.ReactNode]> = [
    ...(overview.communityName
      ? [['Communauté', overview.communityName] as [string, React.ReactNode]]
      : []),
    ['Cotisation', <AmountDisplay key="c" value={group.contributionAmount} />],
    ['Fréquence', frequencyLabel(group.frequency)],
    [
      'Membres',
      overview.activeShareCount > overview.activeMemberCount
        ? `${overview.activeMemberCount} (${overview.activeShareCount} parts)`
        : String(overview.activeMemberCount),
    ],
    [
      'Cagnotte par tour',
      <AmountDisplay key="p" value={overview.potAmount} className="text-green-700" />,
    ],
    [
      admins.length > 1 ? 'Administrateurs' : 'Administrateur',
      admins.join(', ') || overview.adminName,
    ],
  ];
  return (
    <Card>
      <dl className="divide-y divide-slate-200">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex min-h-[48px] items-center justify-between gap-4 px-4 py-2"
          >
            <dt className="text-[13px] text-slate-600">{label}</dt>
            <dd className="text-right text-[15px] font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/** Libellé de la période d'un tour : le mois pour une tontine mensuelle, sinon la date. */
function roundLabel(group: GroupOverview['group'], view: RoundView): string {
  const month = monthName(view.round.dueDate);
  return group.frequency === 'monthly' && !group.dailyContribution
    ? month.charAt(0).toUpperCase() + month.slice(1)
    : shortDate(view.round.dueDate);
}

/**
 * Calendrier de passage, en ligne de temps : mois passés grisés, tour en cours
 * signalé, et mon mois mis en évidence (fond vert clair).
 */
function PayoutCalendar({
  overview,
  rounds,
  userId,
}: {
  overview: GroupOverview;
  rounds: RoundView[];
  userId: string;
}) {
  return (
    <Card>
      <ol className="divide-y divide-slate-200">
        {rounds.map((view) => {
          const { round } = view;
          const past = round.status === 'paid_out';
          const current = round.id === overview.currentRound?.id;
          const mine = view.beneficiaries.some((b) => b.id === userId);
          const names =
            round.recipientType === 'platform'
              ? 'Plateforme'
              : view.beneficiaries.map((b) => (b.id === userId ? 'Toi' : fullName(b))).join(', ');
          return (
            <li
              key={round.id}
              aria-current={current ? 'step' : undefined}
              className={cn(
                'flex min-h-[52px] items-center gap-3 px-4 py-2',
                mine && 'border-l-4 border-green-600 bg-green-50 pl-3',
              )}
            >
              <span
                className={cn(
                  'w-20 shrink-0 text-[13px] font-semibold',
                  past ? 'text-slate-600 line-through decoration-slate-400' : 'text-slate-900',
                )}
              >
                {roundLabel(overview.group, view)}
              </span>
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-[15px]',
                  past ? 'text-slate-600' : 'text-slate-900',
                  mine && 'font-semibold text-green-800',
                )}
              >
                {names}
              </span>
              <span className="shrink-0 text-[13px] text-slate-600">
                {past ? (
                  'Versé'
                ) : current ? (
                  <strong className="font-semibold text-blue-700">En cours</strong>
                ) : (
                  `Tour ${round.number}`
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

/** Membres et leur statut du mois (masqué si le groupe le réserve aux administrateurs). */
function MemberList({ members, userId }: { members: MemberView[]; userId: string }) {
  const active = members.filter((m) => m.membership.status === 'active');
  // Une personne à plusieurs parts n'apparaît qu'une fois.
  const people = active.filter((m) => m.shareNumber === 1);
  const statusesHidden = people.every((m) => m.currentStatus === undefined);
  return (
    <Card>
      <ul className="divide-y divide-slate-200">
        {people.map((member) => {
          const me = member.user.id === userId;
          return (
            <li
              key={member.membership.id}
              className="flex min-h-[56px] items-center gap-3 px-4 py-2"
            >
              <span
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[13px] font-semibold text-slate-700"
              >
                {initials(member.user)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold">
                  {fullName(member.user)}
                  {me ? <span className="font-normal text-slate-600"> · toi</span> : null}
                </span>
                {member.shareCount > 1 || member.membership.role !== 'member' ? (
                  <span className="block text-[13px] text-slate-600">
                    {[
                      member.membership.role === 'owner' || member.membership.role === 'co_admin'
                        ? 'Administrateur'
                        : null,
                      member.shareCount > 1 ? plural(member.shareCount, 'part') : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                ) : null}
              </span>
              {member.currentStatus ? <StatusPill status={member.currentStatus} /> : null}
            </li>
          );
        })}
      </ul>
      {statusesHidden ? (
        <p className="border-t border-slate-200 px-4 py-3 text-[13px] text-slate-600">
          Les statuts de paiement ne sont pas affichés pour ce groupe.
        </p>
      ) : null}
    </Card>
  );
}

/** Détail d'un groupe : fiche, calendrier de passage, membres. */
export default function MemberGroupPage() {
  const { id = '' } = useParams();
  const user = useCurrentUser();
  const navigate = useNavigate();
  const group = useGroup(id);
  const rounds = useRounds(id);
  const members = useMembers(id);

  if (group.isPending) {
    return (
      <div role="status" aria-label="Chargement" className="flex flex-col gap-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-60 rounded-xl" />
        <ListSkeleton rows={4} />
      </div>
    );
  }
  if (group.isError || !group.data) return <ErrorBlock onRetry={() => void group.refetch()} />;

  const overview = group.data;
  const due = duesOf([overview])[0];
  const admins = (members.data ?? [])
    .filter(
      (m) =>
        m.shareNumber === 1 && (m.membership.role === 'owner' || m.membership.role === 'co_admin'),
    )
    .map((m) => fullName(m.user));

  return (
    <div className="flex flex-col gap-6 motion-safe:animate-fade-in">
      <header className="flex flex-col gap-2">
        <Link
          to="/groupes"
          className="-ml-2 flex min-h-[44px] items-center gap-1 self-start rounded-lg px-2 text-[13px] font-semibold text-blue-700 hover:bg-blue-50"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Mes groupes
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[18px] font-bold leading-6">{overview.group.name}</h1>
            <p className="text-[13px] text-slate-600">
              {contributionLabel(overview.group.contributionAmount, overview.group.frequency)}
              {overview.currentRound
                ? ` · tour ${overview.currentRound.number} sur ${overview.totalRounds}`
                : ''}
            </p>
          </div>
          {overview.myStatus ? <StatusPill status={overview.myStatus} /> : null}
        </div>
        {due ? (
          <Button block className="mt-2" onClick={() => navigate(`/payer?tour=${due.round.id}`)}>
            Payer <AmountDisplay value={due.amount} />
          </Button>
        ) : null}
      </header>

      <section aria-labelledby="facts">
        <SectionHeader id="facts" title="Le groupe" />
        <GroupFacts overview={overview} admins={admins} />
      </section>

      <section aria-labelledby="calendar">
        <SectionHeader id="calendar" title="Calendrier de passage" />
        {rounds.isPending ? (
          <ListSkeleton rows={4} />
        ) : rounds.isError ? (
          <ErrorBlock onRetry={() => void rounds.refetch()} />
        ) : (rounds.data ?? []).length === 0 ? (
          <EmptyState
            title="Calendrier pas encore fixé"
            description="L’ordre de passage sera établi au démarrage du groupe."
          />
        ) : (
          <PayoutCalendar overview={overview} rounds={rounds.data ?? []} userId={user.id} />
        )}
      </section>

      <section aria-labelledby="members">
        <SectionHeader id="members" title="Membres" />
        {members.isPending ? (
          <ListSkeleton rows={4} />
        ) : members.isError ? (
          <ErrorBlock onRetry={() => void members.refetch()} />
        ) : (
          <MemberList members={members.data ?? []} userId={user.id} />
        )}
      </section>
    </div>
  );
}
