import { Link } from 'react-router-dom';
import { Badge, Card, GroupPhoto } from '@/components/ui';
import { contributionLabel } from '@/lib/format';
import type { GroupOverview } from '@/types';
import { CycleProgress } from './CycleProgress';
import { GroupStatusBadge } from './GroupStatusBadge';
import { StatusBadge } from './StatusBadge';

interface GroupCardProps {
  overview: GroupOverview;
  to: string;
}

/** Carte de groupe : nom, « 4 500 FCFA par mois », progression du cycle, statut à droite. */
export function GroupCard({ overview, to }: GroupCardProps) {
  const { group, currentRound, totalRounds, myRole, myStatus, myMembershipStatus } = overview;
  const isManager = myRole === 'owner' || myRole === 'co_admin';
  return (
    <Link to={to} className="block rounded-card">
      <Card interactive className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <GroupPhoto name={group.name} src={group.photoUrl} />
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-sans text-card-title text-ink">{group.name}</h3>
            <p className="text-label text-muted">
              {overview.communityName ? `${overview.communityName} · ` : ''}
              {contributionLabel(group.contributionAmount, group.frequency)}
            </p>
          </div>
          {myMembershipStatus === 'pending' ? (
            <Badge tone="warning">Demande envoyée</Badge>
          ) : myStatus ? (
            <StatusBadge status={myStatus} />
          ) : (
            <GroupStatusBadge status={group.status} />
          )}
        </div>
        {group.status === 'active' && currentRound ? (
          <CycleProgress current={currentRound.number} total={totalRounds} />
        ) : null}
        {isManager ? (
          <div>
            <StatusBadge status="admin" label={myRole === 'owner' ? 'Propriétaire' : 'Co-admin'} />
          </div>
        ) : null}
      </Card>
    </Link>
  );
}
