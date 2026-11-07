import { useMemo, useState } from 'react';
import { Plus, Search, Share2, UsersRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { GroupStatusBadge } from '@/components/domain';
import { PageHeader } from '@/components/layout/PageHeader';
import { AsyncContent, Button, Card, EmptyState, Modal } from '@/components/ui';
import { groupContributionLabel, plural, searchable } from '@/lib/format';
import type { GroupOverview, GroupStatus } from '@/types';
import { InviteShare } from '../components/InviteShare';
import { headerLinkClass } from '../components/linkStyles';
import { useShowMore } from '../components/useShowMore';
import { useAdminDashboard, useCommunities } from '../queries';

type Filter = 'all' | 'active' | 'draft' | 'suspended' | 'finished';

const FILTERS: ReadonlyArray<{ value: Filter; label: string }> = [
  { value: 'all', label: 'Tous' },
  { value: 'active', label: 'En cours' },
  { value: 'draft', label: 'Brouillons' },
  { value: 'suspended', label: 'Suspendus' },
  { value: 'finished', label: 'Terminés' },
];

const STATUS_ORDER: Record<GroupStatus, number> = {
  active: 0,
  draft: 1,
  suspended: 2,
  finished: 3,
};

function GroupSummary({
  overview,
  communityName,
}: {
  overview: GroupOverview;
  communityName?: string;
}) {
  const { group } = overview;
  const [inviting, setInviting] = useState(false);
  const percent =
    overview.activeShareCount > 0
      ? Math.min(100, (overview.paidCount / overview.activeShareCount) * 100)
      : 0;

  return (
    <div className="relative">
      <Link
        to={`/admin/groupes/${group.id}`}
        className="block rounded-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700"
      >
        <Card
          interactive
          className="flex h-full flex-col gap-4 transition-colors hover:ring-1 hover:ring-blue-700/30"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate font-sans text-card-title text-ink">{group.name}</h2>
              <p className="mt-1 break-words text-label text-muted">
                {communityName ? `${communityName} · ` : ''}
                {groupContributionLabel(group)} · {overview.totalRounds} tours
              </p>
            </div>
            <GroupStatusBadge status={group.status} />
          </div>

          <div className="flex items-center gap-2 text-label text-muted">
            <UsersRound className="h-4 w-4 shrink-0" aria-hidden="true" />
            {plural(overview.activeMemberCount, 'personne')} · {overview.activeShareCount} parts ·{' '}
            {plural(overview.pendingRequestCount, 'demande')}
          </div>

          {overview.currentRound ? (
            <div className="mt-auto flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2 text-small">
                <span className="font-bold text-ink">
                  Tour {overview.currentRound.number} · {overview.paidCount}/
                  {overview.activeShareCount} parts payées
                </span>
                <span className="shrink-0 text-muted">{Math.round(percent)} %</span>
              </div>
              <div
                role="progressbar"
                aria-label={`Collecte du tour ${overview.currentRound.number} pour ${group.name}`}
                aria-valuemin={0}
                aria-valuemax={overview.activeShareCount}
                aria-valuenow={overview.paidCount}
                className="h-2 overflow-hidden rounded-pill bg-blue-100"
              >
                <div
                  className="h-full rounded-pill bg-green-600"
                  style={{
                    width: `${percent}%`,
                  }}
                />
              </div>
              <p className="text-small text-muted">
                {overview.paidCount} parts payées sur {overview.activeShareCount}
              </p>
            </div>
          ) : (
            <p className="mt-auto rounded-control bg-blue-50 px-3 py-2 text-small text-muted">
              {group.status === 'draft' ? 'En attente de démarrage' : 'Aucun tour en cours'}
            </p>
          )}

          <span className="sr-only">Gérer le groupe {group.name}</span>
        </Card>
      </Link>
      {/* Avant le démarrage : inviter sans ouvrir le groupe (bouton hors du lien de la carte). */}
      {group.status === 'draft' ? (
        <>
          <Button
            size="sm"
            variant="secondary"
            className="absolute bottom-4 right-4"
            onClick={() => setInviting(true)}
            icon={<Share2 className="h-4 w-4" aria-hidden="true" />}
          >
            Inviter
          </Button>
          <Modal
            open={inviting}
            onClose={() => setInviting(false)}
            title={`Inviter dans « ${group.name} »`}
          >
            <InviteShare code={group.inviteCode} groupName={group.name} />
          </Modal>
        </>
      ) : null}
    </div>
  );
}

export default function AdminGroupsPage() {
  const query = useAdminDashboard();
  const communities = useCommunities();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const groups = useMemo(
    () =>
      [...(query.data?.groups ?? [])]
        .filter(({ group }) => filter === 'all' || group.status === filter)
        .filter(
          ({ group }) => !search || searchable(group.name).includes(searchable(search.trim())),
        )
        .sort((a, b) => STATUS_ORDER[a.group.status] - STATUS_ORDER[b.group.status]),
    [query.data?.groups, filter, search],
  );
  // Cartes par 12 (4 rangées de 3 sur ordinateur), puis « Voir plus ».
  const page = useShowMore(groups, 12, `${filter}|${search}`);
  const total = query.data?.groups.length ?? 0;
  const active = query.data?.groups.filter(({ group }) => group.status === 'active').length ?? 0;
  const communityNames = new Map(
    (communities.data ?? []).map((community) => [community.id, community.name]),
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Mes groupes"
        plain
        subtitle={`${plural(total, 'groupe')} gérés · ${plural(active, 'groupe actif')}`}
        actions={
          <Link to="/admin/groupes/nouveau" className={headerLinkClass.blue}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Créer un groupe
          </Link>
        }
      />

      <AsyncContent query={query}>
        {(data) => {
          if (data.groups.length === 0) {
            return (
              <EmptyState
                title="Aucun groupe à gérer"
                description="Créez votre première tontine pour commencer à suivre les cotisations et les tours."
                action={
                  <Link to="/admin/groupes/nouveau" className={headerLinkClass.blue}>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Créer un groupe
                  </Link>
                }
              />
            );
          }

          return (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Card className="flex flex-col gap-1">
                  <span className="text-label text-muted">Groupes gérés</span>
                  <strong className="font-display text-section text-blue-900">
                    {data.groups.length}
                  </strong>
                </Card>
                <Card className="flex flex-col gap-1">
                  <span className="text-label text-muted">Groupes actifs</span>
                  <strong className="font-display text-section text-blue-900">{active}</strong>
                </Card>
                <Card className="col-span-2 flex flex-col gap-1 sm:col-span-1">
                  <span className="text-label text-muted">Membres des groupes actifs</span>
                  <strong className="font-display text-section text-blue-900">
                    {data.groups
                      .filter(({ group }) => group.status === 'active')
                      .reduce((sum, overview) => sum + overview.activeMemberCount, 0)}
                  </strong>
                </Card>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <label className="relative min-w-0 flex-1">
                  <span className="sr-only">Rechercher un groupe</span>
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Rechercher un groupe…"
                    className="h-12 w-full rounded-control border border-line bg-white pl-10 pr-3 text-body text-ink placeholder:text-muted focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </label>
                <div
                  className="no-scrollbar flex gap-2 overflow-x-auto pb-1"
                  role="group"
                  aria-label="Filtrer les groupes"
                >
                  {FILTERS.map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={filter === value}
                      onClick={() => setFilter(value)}
                      className={`min-h-touch shrink-0 rounded-pill px-4 text-label font-bold transition-colors ${
                        filter === value
                          ? 'bg-blue-700 text-white'
                          : 'border border-line bg-white text-ink hover:border-blue-700'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {groups.length > 0 ? (
                <>
                  <section
                    className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
                    aria-label="Groupes à gérer"
                  >
                    {page.visible.map((overview) => (
                      <GroupSummary
                        key={overview.group.id}
                        overview={overview}
                        communityName={
                          overview.group.communityId
                            ? communityNames.get(overview.group.communityId)
                            : undefined
                        }
                      />
                    ))}
                  </section>
                  {page.more ? <div className="flex justify-center">{page.more}</div> : null}
                </>
              ) : (
                <EmptyState
                  title="Aucun groupe correspondant"
                  description="Modifiez la recherche ou choisissez un autre statut."
                />
              )}
            </>
          );
        }}
      </AsyncContent>
    </div>
  );
}
