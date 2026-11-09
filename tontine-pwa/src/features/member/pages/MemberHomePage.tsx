import { useState } from 'react';
import { Bell, Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { JoinGroupDialog } from '@/features/groups/JoinGroupDialog';
import { useMyGroups } from '@/features/groups/queries';
import { useUnreadCount } from '@/features/notifications/queries';
import { useCurrentUser } from '@/hooks/useAuth';
import { contributionLabelIn, dayLabelIn, monthNameIn, shortDateIn, useT } from '@/i18n';
import { cn } from '@/lib/cn';
import { initials } from '@/lib/format';
import type { GroupOverview } from '@/types';
import {
  activeGroups,
  deadlineLabel,
  duesOf,
  myPayoutAmount,
  periodLabel,
  type Due,
} from '../dues';
import { PageGuide } from '../guide/PageGuide';
import { AmountDisplay } from '../ui/AmountDisplay';
import { Button } from '../ui/Button';
import { Card, SectionHeader } from '../ui/Card';
import { CalabashShape, EmptyState, ErrorBlock } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';
import { StatusPill } from '../ui/StatusPill';

// Accueil traduit en français et en wolof (voir src/i18n) : la langue se choisit
// dans le Profil.

/**
 * La cotisation la plus urgente, mise en avant : c'est l'élément principal de l'écran
 * et le seul bouton principal (« Payer maintenant »).
 */
function NextDueCard({ due, others }: { due: Due; others: number }) {
  const navigate = useNavigate();
  const { t, language } = useT();
  const late = due.status === 'late';
  const deadline = deadlineLabel(due.round.dueDate, new Date(), language);
  return (
    <section
      data-guide="home-due"
      aria-labelledby="next-due"
      className="relative overflow-hidden rounded-xl bg-blue-900 px-4 pb-4 pt-4 text-white"
    >
      {/* Calebasse en filigrane, à peine visible : la seule touche décorative. */}
      <CalabashShape className="pointer-events-none absolute -right-6 -top-2 h-28 w-40 text-blue-800" />
      <div className="relative flex flex-col gap-3">
        <div>
          <p id="next-due" className="text-[13px] font-medium text-blue-200">
            {t('home.nextDue')}
          </p>
          <p className="mt-1 text-[15px] font-semibold">
            {due.overview.group.name} · {periodLabel(due.overview, due.round, language)}
          </p>
        </div>
        <AmountDisplay value={due.amount} size="xl" />
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-blue-200">
            {t('home.before', { date: shortDateIn(language, due.round.dueDate) })}
          </span>
          <span aria-hidden="true" className="text-blue-300">
            ·
          </span>
          {late ? (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-700">
              {deadline}
            </span>
          ) : (
            <span className="font-semibold">{deadline}</span>
          )}
          {due.overview.myPenalty > 0 ? (
            <span className="text-blue-200">{t('home.penaltyIncluded')}</span>
          ) : null}
        </div>
        {/* Bouton blanc sur la carte bleue foncée : le seul bouton principal de l'écran. */}
        <button
          type="button"
          onClick={() => navigate(`/payer?tour=${due.round.id}`)}
          className="mt-1 min-h-[48px] rounded-lg bg-white px-4 text-[15px] font-semibold text-blue-900 transition-colors duration-150 ease-out hover:bg-blue-50 active:bg-blue-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          {t('home.payNow')}
        </button>
        {others > 0 ? (
          <Link
            to="/payer"
            className="self-start text-[13px] font-semibold text-blue-100 underline underline-offset-4"
          >
            {others > 1 ? t('home.otherDueMany', { count: others }) : t('home.otherDueOne')}
          </Link>
        ) : null}
      </div>
    </section>
  );
}

/** Rien à payer : un encart calme, sans bouton. */
function UpToDateCard({ groups }: { groups: GroupOverview[] }) {
  const { t, language } = useT();
  // Prochaine échéance connue (tour à venir le plus proche).
  const next = groups
    .map((g) => g.currentRound)
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  return (
    <section
      data-guide="home-due"
      className="rounded-xl border border-green-200 bg-green-50 px-4 py-4"
    >
      <p className="text-[15px] font-semibold text-green-800">{t('home.upToDate')}</p>
      <p className="mt-1 text-[13px] text-slate-600">
        {next
          ? t('home.upToDateNext', { date: shortDateIn(language, next.dueDate) })
          : t('home.upToDateNone')}
      </p>
    </section>
  );
}

/** « Ce mois-ci » : une ligne par groupe, statut à droite. */
function MonthStatusList({ groups }: { groups: GroupOverview[] }) {
  const { t, language } = useT();
  return (
    <section data-guide="home-groups" aria-labelledby="month-status">
      <SectionHeader
        id="month-status"
        title={t('home.thisMonth')}
        action={
          <Link to="/groupes" className="text-[13px] font-semibold text-blue-700">
            {t('home.myGroups')}
          </Link>
        }
      />
      <Card>
        <ul className="divide-y divide-slate-200">
          {groups.map(({ group, communityName, myStatus, currentRound, totalRounds }) => (
            <li key={group.id}>
              <Link
                to={`/groupes/${group.id}`}
                className="flex min-h-[56px] items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-slate-50 active:bg-slate-100"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{group.name}</span>
                  <span className="block text-[13px] text-slate-600">
                    {communityName ? `${communityName} · ` : ''}
                    {contributionLabelIn(language, group.contributionAmount, group.frequency)}
                    {currentRound
                      ? ` · ${t('home.round', { number: currentRound.number, total: totalRounds })}`
                      : ''}
                  </span>
                </span>
                {myStatus ? (
                  <StatusPill status={myStatus} />
                ) : (
                  <span className="shrink-0 whitespace-nowrap text-[13px] text-slate-600">
                    {group.status === 'draft' ? t('home.notStarted') : t('home.finished')}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

/** « Mon tour » : quand je reçois la cagnotte, en ligne de temps. */
function MyTurns({ groups, userId }: { groups: GroupOverview[]; userId: string }) {
  const { t, language } = useT();
  const turns = groups
    .filter((g) => g.myTurn)
    .sort((a, b) => (a.myTurn?.dueDate ?? '').localeCompare(b.myTurn?.dueDate ?? ''));
  return (
    <section data-guide="home-turns" aria-labelledby="my-turns">
      <SectionHeader id="my-turns" title={t('home.myTurn')} />
      {turns.length === 0 ? (
        <p className="text-[13px] text-slate-600">{t('home.turnNotSet')}</p>
      ) : (
        <ol className="flex flex-col">
          {turns.map(({ group, myTurn }, index) => {
            if (!myTurn) return null;
            const isLast = index === turns.length - 1;
            return (
              <li key={group.id} className="flex gap-3">
                {/* Ligne de temps : un point vert, relié au suivant par un trait. */}
                <span className="flex flex-col items-center pt-1.5" aria-hidden="true">
                  <span className="h-3 w-3 rounded-full border-2 border-green-600 bg-white" />
                  {!isLast ? <span className="w-px flex-1 bg-slate-200" /> : null}
                </span>
                <Link
                  to={`/groupes/${group.id}`}
                  className={cn(
                    'flex min-w-0 flex-1 items-start justify-between gap-3',
                    !isLast && 'pb-4',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block text-[15px] font-semibold">
                      {t('home.youReceiveIn', { month: monthNameIn(language, myTurn.dueDate) })}
                    </span>
                    <span className="block truncate text-[13px] text-slate-600">
                      {t('home.turnOf', { group: group.name, number: myTurn.number })}
                    </span>
                  </span>
                  <AmountDisplay
                    value={myPayoutAmount(myTurn, userId)}
                    className="text-green-700"
                  />
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function HomeSkeleton() {
  const { t } = useT();
  return (
    <div role="status" aria-label={t('home.loading')} className="flex flex-col gap-6">
      <Skeleton className="h-52 rounded-xl" />
      <Skeleton className="h-36 rounded-xl" />
      <Skeleton className="h-24 rounded-xl" />
    </div>
  );
}

/** Accueil du membre : la prochaine cotisation domine, le reste est secondaire. */
export default function MemberHomePage() {
  const user = useCurrentUser();
  const unread = useUnreadCount();
  const query = useMyGroups();
  const { t, language } = useT();
  const [joinOpen, setJoinOpen] = useState(false);

  // Accueil : les groupes en cours. Un groupe clôturé ou archivé reste dans « Groupes »
  // (et ses paiements dans l'Historique) ; il ne revient ici que s'il reste à y payer.
  const mine = activeGroups(query.data ?? []);
  const groups = mine.filter(
    (overview) =>
      (overview.group.status !== 'finished' && !overview.group.archivedAt) ||
      duesOf([overview]).length > 0,
  );
  const hasPastGroups = groups.length < mine.length;
  const dues = duesOf(groups);

  return (
    <div className="flex flex-col gap-6 motion-safe:animate-fade-in">
      <header className="flex items-center justify-between gap-3">
        {/* Ma photo (sinon mes initiales), comme sur le profil ; un appui ouvre le profil. */}
        <Link to="/profil" aria-label="Mon profil" className="shrink-0 rounded-full">
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
          ) : (
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-[15px] font-bold text-green-800">
              {initials(user)}
            </span>
          )}
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[18px] font-bold leading-6">
            {t('home.hello', { name: user.firstName })}
          </h1>
          <p className="text-[13px] text-slate-600">{dayLabelIn(language, new Date())}</p>
        </div>
        <Link
          to="/notifications"
          data-guide="home-bell"
          aria-label={
            unread > 0 ? t('home.notificationsUnread', { count: unread }) : t('home.notifications')
          }
          className="relative flex h-11 w-11 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100"
        >
          <Bell className="h-6 w-6" aria-hidden="true" />
          {unread > 0 ? (
            <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-green-600 ring-2 ring-white" />
          ) : null}
        </Link>
      </header>

      {query.isPending ? (
        <HomeSkeleton />
      ) : query.isError ? (
        <ErrorBlock onRetry={() => void query.refetch()} />
      ) : groups.length === 0 ? (
        <EmptyState
          title={hasPastGroups ? t('home.allFinishedTitle') : t('home.emptyTitle')}
          description={hasPastGroups ? t('home.allFinishedText') : t('home.emptyText')}
          action={
            <Button block onClick={() => setJoinOpen(true)}>
              {t('home.join')}
            </Button>
          }
        />
      ) : (
        <>
          {dues[0] ? (
            <NextDueCard due={dues[0]} others={dues.length - 1} />
          ) : (
            <UpToDateCard groups={groups} />
          )}
          <MonthStatusList groups={groups} />
          <MyTurns groups={groups} userId={user.id} />
          <button
            type="button"
            onClick={() => setJoinOpen(true)}
            className="flex min-h-[44px] items-center gap-2 self-start rounded-lg px-1 text-[15px] font-semibold text-blue-700 hover:bg-blue-50"
          >
            <Plus className="h-5 w-5" aria-hidden="true" />
            {t('home.joinAnother')}
          </button>
        </>
      )}

      <Link
        to="/reclamation"
        className="text-center text-[13px] font-semibold text-blue-700 underline"
      >
        Un problème ? Faire une réclamation
      </Link>
      <JoinGroupDialog open={joinOpen} onClose={() => setJoinOpen(false)} />
      <PageGuide id="home" ready={!query.isPending} />
    </div>
  );
}
