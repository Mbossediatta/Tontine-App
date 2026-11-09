import { useState } from 'react';
import { Bell, ChevronRight, Plus, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { UnreadCount } from '@/components/layout/UnreadDot';
import {
  Button,
  Card,
  CardTitle,
  EmptyState,
  ErrorState,
  GroupPhoto,
  PageSkeleton,
} from '@/components/ui';
import { ParticipateButton } from '@/features/admin/manage/ParticipateButton';
import { canParticipate } from '@/features/admin/manage/participation';
import { useAdminDashboard } from '@/features/admin/queries';
import { PushPromptCard } from '@/features/notifications/PushPromptCard';
import { useUnreadCount } from '@/features/notifications/queries';
import { useCurrentUser } from '@/hooks/useAuth';
import { StatusBadge } from '@/components/domain';
import { formatMonth, groupContributionLabel } from '@/lib/format';
import type { GroupOverview } from '@/types';
import { JoinGroupDialog } from './JoinGroupDialog';
import { DueList, NextTurnCard, SummaryCard } from './HomeSections';
import { useMyGroups } from './queries';

/**
 * Groupes que l'admin gère sans y cotiser et qu'il peut encore rejoindre (avant le
 * démarrage) : une part en un geste, sans code.
 */
function GroupsToJoin() {
  const dashboard = useAdminDashboard();
  const groups = dashboard.data?.groups.filter(canParticipate) ?? [];
  if (groups.length === 0) return null;
  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>Participer à un groupe que vous gérez</CardTitle>
      <p className="text-label text-muted">
        Vous gérez ces groupes sans y cotiser. Prenez-y une part comme les autres membres : vous
        cotiserez à chaque tour et recevrez la cagnotte à votre tour.
      </p>
      <ul className="flex flex-col divide-y divide-line">
        {groups.map(({ group }) => (
          <li key={group.id} className="flex items-center justify-between gap-3 py-2">
            <span className="min-w-0 truncate font-bold text-ink">{group.name}</span>
            <ParticipateButton groupId={group.id} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * Les groupes où l'on cotise, comme sur l'accueil d'un membre : un appui ouvre le groupe
 * (cagnotte, calendrier, membres). Les groupes archivés n'y figurent pas.
 */
function MyGroupsCard({ groups }: { groups: GroupOverview[] }) {
  const current = groups.filter(({ group }) => !group.archivedAt);
  if (current.length === 0) return null;
  return (
    <Card className="flex flex-col gap-2">
      <CardTitle>Mes groupes</CardTitle>
      <ul className="flex flex-col divide-y divide-line">
        {current.map(({ group, myStatus, currentRound, totalRounds }) => (
          <li key={group.id}>
            <Link
              to={`/groupes/${group.id}`}
              className="flex min-h-touch items-center gap-3 py-3 hover:bg-blue-50"
            >
              <GroupPhoto name={group.name} src={group.photoUrl} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold text-ink">{group.name}</span>
                <span className="block text-label text-muted">
                  {groupContributionLabel(group)}
                  {currentRound ? ` · tour ${currentRound.number} sur ${totalRounds}` : ''}
                </span>
              </span>
              {myStatus ? (
                <StatusBadge status={myStatus} />
              ) : (
                <span className="shrink-0 text-label text-muted">
                  {group.status === 'draft' ? 'Pas commencé' : 'Terminé'}
                </span>
              )}
              <ChevronRight className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function HomePage() {
  const user = useCurrentUser();
  const unread = useUnreadCount();
  const query = useMyGroups();
  const [joinOpen, setJoinOpen] = useState(false);
  // Admin ou super admin : l'espace membre est une rubrique de leur menu (titre sobre).
  const isAdmin = user.globalRole !== 'user';
  const month = formatMonth(new Date());
  const adminMonth = month.charAt(0).toUpperCase() + month.slice(1);

  const groups = query.data?.filter((g) => g.myMembershipStatus === 'active') ?? [];

  return (
    <div className="flex flex-col gap-3">
      {isAdmin ? (
        <header className="flex flex-col gap-2">
          <h1 className="font-display text-page-title text-blue-900">Espace membre</h1>
          <p className="text-body text-muted">Vos cotisations et vos tours · {adminMonth}</p>
        </header>
      ) : (
        <header className="-mx-page -mt-4 flex items-center justify-between bg-white px-page py-4 shadow-card sm:-mx-page-sm sm:px-page-sm lg:mx-0 lg:mt-0 lg:rounded-card lg:px-6">
          <h1 className="text-page-title text-blue-900">Bonjour, {user.firstName}</h1>
          <Link
            to="/notifications"
            aria-label={`Notifications${unread ? ` (${unread} non lues)` : ''}`}
            className="relative flex h-11 w-11 items-center justify-center rounded-full bg-blue-50 text-blue-700"
          >
            <Bell className="h-6 w-6" aria-hidden="true" />
            <UnreadCount count={unread} />
          </Link>
        </header>
      )}

      {/* Rejoindre en un geste un groupe qu'il gère : réservé à l'admin de groupe. */}
      {user.globalRole === 'admin' ? <GroupsToJoin /> : null}

      {query.isPending ? (
        <PageSkeleton />
      ) : query.isError ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : groups.length === 0 ? (
        <EmptyState
          title="Vous n’avez pas encore de groupe"
          description="Rejoignez une tontine avec le code d’invitation reçu de l’administrateur."
          action={
            <Button
              variant="blue"
              className="w-full"
              onClick={() => setJoinOpen(true)}
              icon={<Users className="h-5 w-5" aria-hidden="true" />}
            >
              Rejoindre un groupe
            </Button>
          }
        />
      ) : (
        <>
          <SummaryCard groups={groups} />
          <MyGroupsCard groups={groups} />
          <DueList groups={groups} />
          <NextTurnCard groups={groups} />
          <Button
            variant="blue"
            className="w-full"
            onClick={() => setJoinOpen(true)}
            icon={<Plus className="h-5 w-5" aria-hidden="true" />}
          >
            Rejoindre un groupe
          </Button>
        </>
      )}

      <PushPromptCard />
      <JoinGroupDialog open={joinOpen} onClose={() => setJoinOpen(false)} />
    </div>
  );
}
