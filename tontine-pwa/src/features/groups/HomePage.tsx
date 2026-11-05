import { useState } from 'react';
import { Bell, Plus, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { UnreadCount } from '@/components/layout/UnreadDot';
import { Button, EmptyState, ErrorState, PageSkeleton } from '@/components/ui';
import { PushPromptCard } from '@/features/notifications/PushPromptCard';
import { useUnreadCount } from '@/features/notifications/queries';
import { useCurrentUser } from '@/hooks/useAuth';
import { formatMonth } from '@/lib/format';
import { JoinGroupDialog } from './JoinGroupDialog';
import { DueList, NextTurnCard, SummaryCard } from './HomeSections';
import { useMyGroups } from './queries';

export default function HomePage() {
  const user = useCurrentUser();
  const unread = useUnreadCount();
  const query = useMyGroups();
  const [joinOpen, setJoinOpen] = useState(false);
  const isAdmin = user.globalRole === 'admin';
  const month = formatMonth(new Date());
  const adminMonth = month.charAt(0).toUpperCase() + month.slice(1);

  const groups = query.data?.filter((g) => g.myMembershipStatus === 'active') ?? [];

  return (
    <div className="flex flex-col gap-3">
      {isAdmin ? (
        <header className="flex flex-col gap-2">
          <h1 className="font-display text-page-title text-blue-900">Espace membre</h1>
          <p className="text-body text-muted">
            Vos cotisations et vos tours · {adminMonth}
          </p>
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
