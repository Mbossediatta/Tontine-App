import { useMemo, useState } from 'react';
import { Archive, ChevronRight, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { GroupStatusBadge } from '@/components/domain';
import { PageHeader } from '@/components/layout/PageHeader';
import { AsyncContent, Badge, Card, EmptyState, Select } from '@/components/ui';
import { groupContributionLabel, fullName, plural, searchable } from '@/lib/format';
import type { GroupOverview } from '@/types';
import { headerLinkClass } from '../components/linkStyles';
import { CollapsibleFilters, FilterChips, SearchField } from '../components/ListToolbar';
import { useAdmins, useAllGroups, useCommunities } from '../queries';

type StatusFilter = 'all' | 'active' | 'draft' | 'suspended' | 'finished' | 'archived';

/** Tranches de cotisation (FCFA) et de nombre de parts proposées dans les filtres. */
const AMOUNT_RANGES = {
  all: { label: 'Tous les montants', min: 0, max: Infinity },
  small: { label: 'Jusqu’à 5 000 FCFA', min: 0, max: 5000 },
  medium: { label: '5 001 à 20 000 FCFA', min: 5001, max: 20000 },
  large: { label: 'Plus de 20 000 FCFA', min: 20001, max: Infinity },
} as const;
const SIZE_RANGES = {
  all: { label: 'Toutes les tailles', min: 0, max: Infinity },
  small: { label: 'Jusqu’à 5 parts', min: 0, max: 5 },
  medium: { label: '6 à 10 parts', min: 6, max: 10 },
  large: { label: 'Plus de 10 parts', min: 11, max: Infinity },
} as const;
type AmountRange = keyof typeof AMOUNT_RANGES;
type SizeRange = keyof typeof SIZE_RANGES;

/** Le groupe correspond-il au filtre de statut ? Les archivés n'apparaissent que sous « Archivés ». */
function matchesStatus({ group }: GroupOverview, status: StatusFilter): boolean {
  if (status === 'archived') return group.archivedAt !== undefined;
  if (group.archivedAt) return false;
  return status === 'all' || group.status === status;
}

/** Colonnes sur écran large : groupe · admin · membres · tour · statut · flèche. */
const COLUMNS =
  'md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,1fr)_20px]';

/**
 * Rubrique « Groupes » du super administrateur : tous les groupes de la plateforme,
 * filtrables par statut, admin, montant de cotisation et nombre de parts.
 */
export default function SuperGroupsPage() {
  const groups = useAllGroups();
  const admins = useAdmins();
  const communities = useCommunities();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [adminId, setAdminId] = useState('');
  const [communityId, setCommunityId] = useState('');
  const [amount, setAmount] = useState<AmountRange>('all');
  const [size, setSize] = useState<SizeRange>('all');

  // Nombre de groupes par statut, pour les pastilles de filtre.
  const counts = useMemo(() => {
    const list = groups.data ?? [];
    const count = (s: StatusFilter) => list.filter((g) => matchesStatus(g, s)).length;
    return {
      all: count('all'),
      active: count('active'),
      draft: count('draft'),
      suspended: count('suspended'),
      finished: count('finished'),
      archived: count('archived'),
    };
  }, [groups.data]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Groupes"
        plain
        subtitle={`${plural(counts.all, 'groupe')} sur la plateforme · ${plural(counts.archived, 'archivé')}`}
        actions={
          <Link to="/admin/groupes/nouveau" className={headerLinkClass.blue}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Nouveau groupe
          </Link>
        }
      />

      <SearchField value={search} onChange={setSearch} placeholder="Rechercher un groupe…" />
      <FilterChips
        label="Filtrer par statut"
        value={status}
        onChange={setStatus}
        options={[
          { value: 'all', label: 'Tous', count: counts.all },
          { value: 'active', label: 'En cours', count: counts.active },
          { value: 'draft', label: 'Brouillons', count: counts.draft },
          { value: 'suspended', label: 'Suspendus', count: counts.suspended },
          { value: 'finished', label: 'Terminés', count: counts.finished },
          { value: 'archived', label: 'Archivés', count: counts.archived },
        ]}
      />
      <CollapsibleFilters
        activeCount={
          [communityId, adminId, amount !== 'all', size !== 'all'].filter(Boolean).length
        }
        className="grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <Select
          label="Communauté"
          value={communityId}
          onChange={(e) => setCommunityId(e.target.value)}
          options={[
            { value: '', label: 'Toutes les communautés' },
            ...(communities.data ?? []).map((community) => ({
              value: community.id,
              label: community.name,
            })),
          ]}
        />
        <Select
          label="Administrateur"
          value={adminId}
          onChange={(e) => setAdminId(e.target.value)}
          options={[
            { value: '', label: 'Tous les administrateurs' },
            ...(admins.data ?? []).map((a) => ({ value: a.user.id, label: fullName(a.user) })),
          ]}
        />
        <Select
          label="Cotisation"
          value={amount}
          onChange={(e) => setAmount(e.target.value as AmountRange)}
          options={Object.entries(AMOUNT_RANGES).map(([value, r]) => ({ value, label: r.label }))}
        />
        <Select
          label="Nombre de parts"
          value={size}
          onChange={(e) => setSize(e.target.value as SizeRange)}
          options={Object.entries(SIZE_RANGES).map(([value, r]) => ({ value, label: r.label }))}
        />
      </CollapsibleFilters>

      <AsyncContent query={groups}>
        {(list) => {
          const words = searchable(search.trim());
          const amountRange = AMOUNT_RANGES[amount];
          const sizeRange = SIZE_RANGES[size];
          const visible = list.filter((overview) => {
            const { group, activeShareCount } = overview;
            return (
              matchesStatus(overview, status) &&
              (!communityId || group.communityId === communityId) &&
              (!adminId || group.adminId === adminId) &&
              group.contributionAmount >= amountRange.min &&
              group.contributionAmount <= amountRange.max &&
              activeShareCount >= sizeRange.min &&
              activeShareCount <= sizeRange.max &&
              (!words || searchable(group.name).includes(words))
            );
          });

          if (visible.length === 0) {
            return (
              <EmptyState
                title="Aucun groupe"
                description="Aucun groupe ne correspond à ces critères."
              />
            );
          }
          return (
            <Card>
              <div
                className={`hidden gap-3 border-b border-line px-2 pb-2 text-small uppercase tracking-wide text-muted md:grid ${COLUMNS}`}
                aria-hidden="true"
              >
                <span>Groupe</span>
                <span>Administrateur</span>
                <span>Personnes / parts</span>
                <span>Tour</span>
                <span>Statut</span>
                <span />
              </div>
              <ul className="divide-y divide-line">
                {visible.map(
                  ({
                    group,
                    adminName,
                    activeMemberCount,
                    activeShareCount,
                    currentRound,
                    totalRounds,
                  }) => (
                    <li key={group.id}>
                      {/* Mobile : nom + statut, puis cotisation, admin et chiffres sur 2 lignes. */}
                      <Link
                        to={`/admin/groupes/${group.id}`}
                        className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-control px-2 py-3 transition-colors duration-150 hover:bg-blue-50 ${COLUMNS}`}
                      >
                        <span className="min-w-0 md:order-1">
                          <span className="block truncate font-bold text-ink">{group.name}</span>
                          <span className="block text-small text-muted">
                            {groupContributionLabel(group)}
                          </span>
                        </span>
                        <span className="flex flex-wrap justify-end gap-1 md:order-5 md:justify-start">
                          <GroupStatusBadge status={group.status} />
                          {group.archivedAt ? (
                            <Badge icon={<Archive className="h-3.5 w-3.5" aria-hidden="true" />}>
                              Archivé
                            </Badge>
                          ) : null}
                        </span>
                        <span className="col-span-2 truncate text-label text-ink md:order-2 md:col-span-1">
                          <span className="text-muted md:hidden">Admin : </span>
                          {adminName}
                        </span>
                        <span className="text-label tabular-nums text-ink md:order-3">
                          {activeMemberCount} pers. · {activeShareCount}/{group.maxMembers} parts
                        </span>
                        <span className="justify-self-end text-label tabular-nums text-ink md:order-4 md:justify-self-auto">
                          {currentRound ? `Tour ${currentRound.number} / ${totalRounds}` : '—'}
                        </span>
                        <ChevronRight
                          className="hidden h-5 w-5 text-muted md:order-6 md:block"
                          aria-hidden="true"
                        />
                      </Link>
                    </li>
                  ),
                )}
              </ul>
            </Card>
          );
        }}
      </AsyncContent>
    </div>
  );
}
