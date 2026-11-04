import { ArrowRight, HandCoins } from 'lucide-react';
import { Link } from 'react-router-dom';
import { GroupStatusBadge } from '@/components/domain';
import { PageHeader } from '@/components/layout/PageHeader';
import { AsyncContent, Card, EmptyState } from '@/components/ui';
import { formatDate, plural } from '@/lib/format';
import type { GroupOverview } from '@/types';
import { useAdminDashboard } from '../queries';

function ContributionGroupCard({ overview }: { overview: GroupOverview }) {
  const { group, currentRound } = overview;
  const percent =
    overview.activeShareCount > 0
      ? Math.min(100, (overview.paidCount / overview.activeShareCount) * 100)
      : 0;

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-card-title text-ink">{group.name}</h2>
          <p className="mt-1 text-label text-muted">
            {currentRound
              ? `Tour ${currentRound.number} · échéance ${formatDate(currentRound.dueDate)}`
              : group.status === 'draft'
                ? 'Les cotisations commenceront au démarrage du cycle.'
                : 'Aucun tour en cours.'}
          </p>
        </div>
        <GroupStatusBadge status={group.status} />
      </div>

      {currentRound ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2 text-label">
            <span className="font-semibold text-ink">
              {overview.paidCount} / {overview.activeShareCount} parts payées
            </span>
            <span className="text-muted">{Math.round(percent)} %</span>
          </div>
          <div
            role="progressbar"
            aria-label={`Cotisations reçues pour ${group.name}`}
            aria-valuemin={0}
            aria-valuemax={overview.activeShareCount}
            aria-valuenow={overview.paidCount}
            className="h-2 overflow-hidden rounded-pill bg-blue-100"
          >
            <div className="h-full rounded-pill bg-green-600" style={{ width: `${percent}%` }} />
          </div>
        </div>
      ) : (
        <p className="text-label text-muted">
          {plural(overview.activeMemberCount, 'personne')} · {overview.activeShareCount} parts
        </p>
      )}

      <Link
        to={`/admin/groupes/${group.id}?onglet=paiements`}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-blue-700 px-4 font-bold text-white hover:bg-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
      >
        <HandCoins className="h-5 w-5" aria-hidden="true" />
        Suivre les cotisations
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </Card>
  );
}

export default function AdminContributionsPage() {
  const query = useAdminDashboard();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Suivi des cotisations"
        plain
        subtitle="Consultez les paiements et relancez les membres de vos groupes."
      />
      <AsyncContent query={query}>
        {(data) =>
          data.groups.length > 0 ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {data.groups.map((overview) => (
                <ContributionGroupCard key={overview.group.id} overview={overview} />
              ))}
            </div>
          ) : (
            <EmptyState
              title="Aucun groupe à suivre"
              description="Les groupes que vous gérez apparaîtront ici."
            />
          )
        }
      </AsyncContent>
    </div>
  );
}
