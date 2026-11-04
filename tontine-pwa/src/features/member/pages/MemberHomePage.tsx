import { useState } from 'react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Bell, Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { JoinGroupDialog } from '@/features/groups/JoinGroupDialog';
import { useMyGroups } from '@/features/groups/queries';
import { useUnreadCount } from '@/features/notifications/queries';
import { useCurrentUser } from '@/hooks/useAuth';
import { cn } from '@/lib/cn';
import { contributionLabel, plural } from '@/lib/format';
import type { GroupOverview } from '@/types';
import {
  activeGroups,
  deadlineLabel,
  duesOf,
  monthName,
  myPayoutAmount,
  periodLabel,
  shortDate,
  type Due,
} from '../dues';
import { AmountDisplay } from '../ui/AmountDisplay';
import { Button } from '../ui/Button';
import { Card, SectionHeader } from '../ui/Card';
import { CalabashShape, EmptyState, ErrorBlock } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';
import { StatusPill } from '../ui/StatusPill';

/** « Mardi 3 novembre » */
const todayLabel = () => {
  const text = format(new Date(), 'EEEE d MMMM', { locale: fr });
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/**
 * La cotisation la plus urgente, mise en avant : c'est l'élément principal de l'écran
 * et le seul bouton principal (« Payer maintenant »).
 */
function NextDueCard({ due, others }: { due: Due; others: number }) {
  const navigate = useNavigate();
  const late = due.status === 'late';
  return (
    <section
      aria-labelledby="next-due"
      className="relative overflow-hidden rounded-xl bg-blue-900 px-4 pb-4 pt-4 text-white"
    >
      {/* Calebasse en filigrane, à peine visible : la seule touche décorative. */}
      <CalabashShape className="pointer-events-none absolute -right-6 -top-2 h-28 w-40 text-blue-800" />
      <div className="relative flex flex-col gap-3">
        <div>
          <p id="next-due" className="text-[13px] font-medium text-blue-200">
            Prochaine cotisation
          </p>
          <p className="mt-1 text-[15px] font-semibold">
            {due.overview.group.name} · {periodLabel(due.overview, due.round)}
          </p>
        </div>
        <AmountDisplay value={due.amount} size="xl" />
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-blue-200">Avant le {shortDate(due.round.dueDate)}</span>
          <span aria-hidden="true" className="text-blue-300">
            ·
          </span>
          {late ? (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-700">
              {deadlineLabel(due.round.dueDate)}
            </span>
          ) : (
            <span className="font-semibold">{deadlineLabel(due.round.dueDate)}</span>
          )}
          {due.overview.myPenalty > 0 ? (
            <span className="text-blue-200">· pénalité incluse</span>
          ) : null}
        </div>
        {/* Bouton blanc sur la carte bleue foncée : le seul bouton principal de l'écran. */}
        <button
          type="button"
          onClick={() => navigate(`/payer?tour=${due.round.id}`)}
          className="mt-1 min-h-[48px] rounded-lg bg-white px-4 text-[15px] font-semibold text-blue-900 transition-colors duration-150 ease-out hover:bg-blue-50 active:bg-blue-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          Payer maintenant
        </button>
        {others > 0 ? (
          <Link
            to="/payer"
            className="self-start text-[13px] font-semibold text-blue-100 underline underline-offset-4"
          >
            {plural(others, 'autre cotisation', 'autres cotisations')} à payer
          </Link>
        ) : null}
      </div>
    </section>
  );
}

/** Rien à payer : un encart calme, sans bouton. */
function UpToDateCard({ groups }: { groups: GroupOverview[] }) {
  // Prochaine échéance connue (tour à venir le plus proche).
  const next = groups
    .map((g) => g.currentRound)
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  return (
    <section className="rounded-xl border border-green-200 bg-green-50 px-4 py-4">
      <p className="text-[15px] font-semibold text-green-800">Tu es à jour</p>
      <p className="mt-1 text-[13px] text-slate-600">
        {next
          ? `Toutes tes cotisations du moment sont payées. Prochaine échéance le ${shortDate(next.dueDate)}.`
          : 'Aucune cotisation à payer pour le moment.'}
      </p>
    </section>
  );
}

/** « Ce mois-ci » : une ligne par groupe, statut à droite. */
function MonthStatusList({ groups }: { groups: GroupOverview[] }) {
  return (
    <section aria-labelledby="month-status">
      <SectionHeader
        id="month-status"
        title="Ce mois-ci"
        action={
          <Link to="/groupes" className="text-[13px] font-semibold text-blue-700">
            Mes groupes
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
                    {contributionLabel(group.contributionAmount, group.frequency)}
                    {currentRound ? ` · tour ${currentRound.number}/${totalRounds}` : ''}
                  </span>
                </span>
                {myStatus ? (
                  <StatusPill status={myStatus} />
                ) : (
                  <span className="shrink-0 whitespace-nowrap text-[13px] text-slate-600">
                    {group.status === 'draft' ? 'Pas commencé' : 'Terminé'}
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
  const turns = groups
    .filter((g) => g.myTurn)
    .sort((a, b) => (a.myTurn?.dueDate ?? '').localeCompare(b.myTurn?.dueDate ?? ''));
  return (
    <section aria-labelledby="my-turns">
      <SectionHeader id="my-turns" title="Mon tour" />
      {turns.length === 0 ? (
        <p className="text-[13px] text-slate-600">
          Ton tour n’est pas encore fixé : l’ordre de passage sera décidé au démarrage du groupe.
        </p>
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
                      Tu reçois en {monthName(myTurn.dueDate)}
                    </span>
                    <span className="block truncate text-[13px] text-slate-600">
                      {group.name} · tour {myTurn.number}
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
  return (
    <div role="status" aria-label="Chargement" className="flex flex-col gap-6">
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
  const [joinOpen, setJoinOpen] = useState(false);

  const groups = activeGroups(query.data ?? []);
  const dues = duesOf(groups);

  return (
    <div className="flex flex-col gap-6 motion-safe:animate-fade-in">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-bold leading-6">Bonjour {user.firstName}</h1>
          <p className="text-[13px] text-slate-600">{todayLabel()}</p>
        </div>
        <Link
          to="/notifications"
          aria-label={unread > 0 ? `Notifications, ${unread} non lues` : 'Notifications'}
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
          title="Tu n’as encore rejoint aucun groupe"
          description="Demande le code d’invitation à l’administrateur de ta tontine."
          action={
            <Button block onClick={() => setJoinOpen(true)}>
              Rejoindre un groupe
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
            Rejoindre un autre groupe
          </button>
        </>
      )}

      <JoinGroupDialog open={joinOpen} onClose={() => setJoinOpen(false)} />
    </div>
  );
}
