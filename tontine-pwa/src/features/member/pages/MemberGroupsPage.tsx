import { useState } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { JoinGroupDialog } from '@/features/groups/JoinGroupDialog';
import { useDiscoverableGroups, useMyGroups } from '@/features/groups/queries';
import { contributionLabel, plural } from '@/lib/format';
import { useAction } from '@/lib/query';
import { groupService } from '@/services';
import type { GroupOverview } from '@/types';
import { Button } from '../ui/Button';
import { Card, PageTitle, SectionHeader } from '../ui/Card';
import { EmptyState, ErrorBlock } from '../ui/EmptyState';
import { ListSkeleton } from '../ui/Skeleton';
import { StatusPill } from '../ui/StatusPill';

/** « Mes groupes » : une ligne par groupe, avec mon statut du mois. */
export default function MemberGroupsPage() {
  const query = useMyGroups();
  const discoverable = useDiscoverableGroups();
  const [joinOpen, setJoinOpen] = useState(false);
  const groups = query.data ?? [];
  const joinOpenGroup = useAction<string>({
    action: (groupId) => groupService.requestJoinOpen(groupId),
    success: 'Demande envoyée à l’administrateur',
  });

  return (
    <div className="flex flex-col gap-4 motion-safe:animate-fade-in">
      <PageTitle
        aside={
          groups.length > 0 ? (
            <Button
              variant="quiet"
              onClick={() => setJoinOpen(true)}
              icon={<Plus className="h-5 w-5" aria-hidden="true" />}
            >
              Rejoindre
            </Button>
          ) : null
        }
      >
        Mes groupes
      </PageTitle>

      {query.isPending ? (
        <ListSkeleton rows={3} />
      ) : query.isError ? (
        <ErrorBlock onRetry={() => void query.refetch()} />
      ) : groups.length === 0 ? (
        <EmptyState
          title="Tu n’as encore rejoint aucun groupe"
          description="Demande un code d’invitation à l’administrateur d’une tontine."
          action={
            <Button block onClick={() => setJoinOpen(true)}>
              Rejoindre un groupe
            </Button>
          }
        />
      ) : (
        <Card>
          <ul className="divide-y divide-slate-200">
            {groups.map(
              ({
                group,
                communityName,
                myStatus,
                myMembershipStatus,
                activeMemberCount,
                currentRound,
                totalRounds,
              }) => (
                <li key={group.id}>
                  <Link
                    to={`/groupes/${group.id}`}
                    className="flex min-h-[64px] items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-slate-50 active:bg-slate-100"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold">{group.name}</span>
                      {/* Deux lignes courtes : elles ne se coupent pas au milieu sur téléphone. */}
                      <span className="block text-[13px] text-slate-600">
                        {communityName ? `${communityName} · ` : ''}
                        {contributionLabel(group.contributionAmount, group.frequency)}
                      </span>
                      <span className="block text-[13px] text-slate-600">
                        {plural(activeMemberCount, 'membre')}
                        {currentRound ? ` · Tour ${currentRound.number} sur ${totalRounds}` : ''}
                      </span>
                    </span>
                    {myMembershipStatus === 'pending' ? (
                      <span className="shrink-0 whitespace-nowrap text-[13px] font-semibold text-slate-600">
                        Demande envoyée
                      </span>
                    ) : myStatus ? (
                      <StatusPill status={myStatus} />
                    ) : (
                      <span className="shrink-0 whitespace-nowrap text-[13px] text-slate-600">
                        {group.status === 'draft' ? 'Pas commencé' : 'Terminé'}
                      </span>
                    )}
                    <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
                  </Link>
                </li>
              ),
            )}
          </ul>
        </Card>
      )}

      <DiscoverableGroups
        query={discoverable}
        onJoin={(groupId) => joinOpenGroup.mutate(groupId)}
        joining={joinOpenGroup.isPending}
        joinedId={joinOpenGroup.variables}
      />
      <JoinGroupDialog open={joinOpen} onClose={() => setJoinOpen(false)} />
    </div>
  );
}

function DiscoverableGroups({
  query,
  onJoin,
  joining,
  joinedId,
}: {
  query: ReturnType<typeof useDiscoverableGroups>;
  onJoin: (groupId: string) => void;
  joining: boolean;
  joinedId?: string;
}) {
  if (query.isPending) {
    return (
      <section aria-label="Groupes ouverts dans tes communautés">
        <ListSkeleton rows={2} />
      </section>
    );
  }
  if (query.isError) {
    return (
      <section className="flex flex-col gap-2">
        <SectionHeader title="Groupes ouverts dans tes communautés" />
        <ErrorBlock onRetry={() => void query.refetch()} />
      </section>
    );
  }
  if (query.data.length === 0) return null;

  return (
    <section className="flex flex-col gap-2" aria-labelledby="community-groups-title">
      <SectionHeader id="community-groups-title" title="Groupes ouverts dans tes communautés" />
      <ul className="flex flex-col gap-2">
        {query.data.map((overview) => (
          <OpenGroupCard
            key={overview.group.id}
            overview={overview}
            onJoin={onJoin}
            joining={joining && joinedId === overview.group.id}
            disabled={joining}
          />
        ))}
      </ul>
    </section>
  );
}

function OpenGroupCard({
  overview,
  onJoin,
  joining,
  disabled,
}: {
  overview: GroupOverview;
  onJoin: (groupId: string) => void;
  joining: boolean;
  disabled: boolean;
}) {
  const { group } = overview;
  return (
    <li>
      <Card className="flex flex-col gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold">{group.name}</h3>
          <p className="text-[13px] text-slate-600">
            {overview.communityName ?? 'Ta communauté'} ·{' '}
            {contributionLabel(group.contributionAmount, group.frequency)} ·{' '}
            {plural(Math.max(0, group.maxMembers - overview.activeShareCount), 'place disponible')}
          </p>
        </div>
        {group.description ? (
          <p className="text-[13px] text-slate-600">{group.description}</p>
        ) : null}
        <Button
          variant="secondary"
          className="w-full"
          loading={joining}
          disabled={disabled}
          onClick={() => onJoin(group.id)}
        >
          Demander à rejoindre
        </Button>
      </Card>
    </li>
  );
}
