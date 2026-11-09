import { useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useDebts, useGroup, useMembers, useRounds, useSwaps } from '@/features/groups/queries';
import { SwapList } from '@/features/groups/SwapList';
import { SwapRequestDialog } from '@/features/groups/SwapRequestDialog';
import { useCurrentUser } from '@/hooks/useAuth';
import { cn } from '@/lib/cn';
import { contributionPerTurn, payoutPerShare } from '@/lib/tontine';
import { contributionLabel, frequencyLabel, fullName, initials, plural } from '@/lib/format';
import type { GroupOverview, MemberView, RoundView } from '@/types';
import { DebtCard } from '../components/DebtCard';
import { PayoutReceiptCard } from '../components/PayoutReceiptCard';
import { duesOf, monthName, shortDate } from '../dues';
import { AmountDisplay } from '../ui/AmountDisplay';
import { Button } from '../ui/Button';
import { PageGuide } from '../guide/PageGuide';
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
    // Plusieurs parts par tour : la cagnotte se partage, chaque bénéficiaire reçoit une part.
    ...((group.sharesPerRound ?? 1) > 1
      ? [
          [
            `Chaque bénéficiaire reçoit (${group.sharesPerRound} par tour)`,
            <AmountDisplay
              key="s"
              value={payoutPerShare(overview.potAmount, group.sharesPerRound)}
              className="text-green-700"
            />,
          ] as [string, React.ReactNode],
        ]
      : []),
    // Période de service de la plateforme : ce que chacun y paie (part d'une cotisation).
    ...(group.reserveFinalTurn
      ? [
          [
            'Période de service Calebasse',
            <span key="svc">
              <AmountDisplay value={contributionPerTurn(group, { recipientType: 'platform' })} />
              <span className="block text-[13px] font-normal text-slate-600">
                {group.platformSharePercent ?? 100} % d’une cotisation, en fin de cycle
              </span>
            </span>,
          ] as [string, React.ReactNode],
        ]
      : []),
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
  return group.frequency === 'monthly' && group.turnLength === 1
    ? month.charAt(0).toUpperCase() + month.slice(1)
    : shortDate(view.round.dueDate);
}

/** Seuls des tours à venir s'échangent, entre membres, pendant le cycle. */
function isSwappable(overview: GroupOverview, view: RoundView): boolean {
  return (
    overview.group.status === 'active' &&
    view.round.status === 'upcoming' &&
    view.round.recipientType !== 'platform'
  );
}

/**
 * Calendrier de passage, en ligne de temps : mois passés grisés, tour en cours
 * signalé, et mon mois mis en évidence (fond vert clair). Confidentiel : seuls mes
 * tours portent un nom ; sur un tour à venir d'un autre, je peux proposer un échange.
 */
function PayoutCalendar({
  overview,
  rounds,
  userId,
  onSwap,
}: {
  overview: GroupOverview;
  rounds: RoundView[];
  userId: string;
  /** Absent quand je n'ai pas de tour à venir à céder. */
  onSwap?: (view: RoundView) => void;
}) {
  return (
    <Card>
      <ol className="divide-y divide-slate-200">
        {rounds.map((view) => {
          const { round } = view;
          const past = round.status === 'paid_out';
          const current = round.id === overview.currentRound?.id;
          const mine = view.beneficiaries.some((b) => b.id === userId);
          // Ma part de la cagnotte de ce tour (plusieurs bénéficiaires : la cagnotte se partage).
          const myShare = view.beneficiaryShares.find((share) => share.user.id === userId);
          const names =
            round.recipientType === 'platform' ? 'Plateforme' : mine ? 'Toi' : 'Un autre membre';
          const swappable = onSwap && !mine && isSwappable(overview, view);
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
                <span>{names}</span>
                {mine && myShare && round.recipientType !== 'platform' ? (
                  <>
                    {' · '}
                    <AmountDisplay value={myShare.amount} />
                  </>
                ) : null}
              </span>
              <span className="shrink-0 text-[13px] text-slate-600">
                {past ? (
                  'Versé'
                ) : current ? (
                  <strong className="font-semibold text-blue-700">En cours</strong>
                ) : swappable ? (
                  <button
                    type="button"
                    onClick={() => onSwap(view)}
                    className="-mr-2 min-h-[44px] rounded-lg px-2 font-semibold text-blue-700 hover:bg-blue-50"
                  >
                    Échanger
                  </button>
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
  // Statuts confidentiels : seul le mien est transmis (sauf pour les administrateurs).
  const othersHidden = people.some((m) => m.user.id !== userId && m.currentStatus === undefined);
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
      {othersHidden ? (
        <p className="border-t border-slate-200 px-4 py-3 text-[13px] text-slate-600">
          Par confidentialité, seul ton statut de paiement est affiché.
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
  const swaps = useSwaps(id, group.data?.group.status === 'active');
  const debts = useDebts(id);
  const [swapTarget, setSwapTarget] = useState<RoundView | null>(null);

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
  // Mes tours à venir : ce que je peux céder dans un échange.
  const myRounds = (rounds.data ?? []).filter(
    (view) =>
      isSwappable(overview, view) && view.beneficiaries.some((person) => person.id === user.id),
  );

  return (
    <div className="flex flex-col gap-6 motion-safe:animate-fade-in">
      <header data-guide="group-header" className="flex flex-col gap-2">
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
          <Button
            block
            className="mt-2 lg:w-auto lg:min-w-[280px] lg:self-start"
            onClick={() => navigate(`/payer?tour=${due.round.id}`)}
          >
            Payer <AmountDisplay value={due.amount} />
          </Button>
        ) : null}
      </header>
      {/* Ordinateur : fiche et reçus à gauche ; calendrier, réclamation et membres à droite. */}
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-8">
        <div className="flex flex-col gap-6">
          <DebtCard
            debts={(debts.data ?? []).filter(
              ({ debt }) => debt.status === 'open' && debt.userId === user.id,
            )}
          />

          {(rounds.data ?? [])
            .filter(
              (view) =>
                view.round.status === 'paid_out' &&
                view.round.recipientType !== 'platform' &&
                view.beneficiaries.some((person) => person.id === user.id),
            )
            .map((view) => (
              <PayoutReceiptCard key={view.round.id} view={view} userId={user.id} groupId={id} />
            ))}

          <section data-guide="group-facts" aria-labelledby="facts">
            <SectionHeader id="facts" title="Le groupe" />
            <GroupFacts overview={overview} admins={admins} />
          </section>
        </div>
        <div className="flex flex-col gap-6">
          <section data-guide="group-calendar" aria-labelledby="calendar">
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
              <>
                <SwapList swaps={swaps.data ?? []} myUserId={user.id} mode="member" />
                <PayoutCalendar
                  overview={overview}
                  rounds={rounds.data ?? []}
                  userId={user.id}
                  onSwap={myRounds.length > 0 ? setSwapTarget : undefined}
                />
              </>
            )}
            {swapTarget ? (
              <SwapRequestDialog
                key={swapTarget.round.id}
                target={swapTarget}
                myRounds={myRounds}
                myUserId={user.id}
                onClose={() => setSwapTarget(null)}
              />
            ) : null}
          </section>

          <Link
            to={`/reclamation?groupe=${id}`}
            data-guide="group-claim"
            className="text-center text-[13px] font-semibold text-blue-700 underline"
          >
            Un problème avec un paiement ou une cagnotte ? Faire une réclamation
          </Link>

          <section data-guide="group-members" aria-labelledby="members">
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
      </div>
      <PageGuide id="group" ready={!rounds.isPending && !members.isPending} />
    </div>
  );
}
