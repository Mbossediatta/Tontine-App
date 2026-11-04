import { useState } from 'react';
import { ChevronRight, KeyRound, UserPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { OnlineButton } from '@/components/layout/OnlineButton';
import { PageHeader } from '@/components/layout/PageHeader';
import { AsyncContent, Avatar, Badge, Card, EmptyState } from '@/components/ui';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { formatPhone, fullName, plural } from '@/lib/format';
import type { MemberSummary } from '@/types';
import { AccountFormDialog } from '../components/AccountFormDialog';
import { FilterChips, SearchField } from '../components/ListToolbar';
import { useMembers } from '../queries';

type Filter = 'all' | 'late' | 'blocked' | 'pin';

const FILTERS: Record<Filter, (member: MemberSummary) => boolean> = {
  all: () => true,
  late: (m) => m.lateCount > 0,
  blocked: (m) => m.user.isSuspended,
  pin: (m) => m.pinPending,
};

/** Colonnes sur écran large : membre · rôle · groupes · retards · statut · flèche. */
const COLUMNS =
  'md:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,1.2fr)_20px]';

/**
 * Rubrique « Membres » : tous les comptes de la plateforme, recherche par nom ou
 * numéro, filtres (en retard, bloqués, PIN à créer) ; chaque ligne ouvre la fiche.
 */
export default function MembersPage() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [creating, setCreating] = useState(false);
  // La recherche part une fois la frappe terminée (pas une requête par lettre).
  const query = useMembers(useDebouncedValue(search.trim()));

  const list = query.data ?? [];
  const count = (f: Filter) => list.filter(FILTERS[f]).length;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Membres"
        plain
        subtitle={plural(list.length, 'compte')}
        actions={
          <OnlineButton
            variant="blue"
            size="sm"
            onClick={() => setCreating(true)}
            icon={<UserPlus className="h-4 w-4" aria-hidden="true" />}
          >
            Nouveau membre
          </OnlineButton>
        }
      />
      <SearchField
        value={search}
        onChange={setSearch}
        placeholder="Rechercher par nom ou numéro…"
      />
      <FilterChips
        label="Filtrer les membres"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'Tous', count: count('all') },
          { value: 'late', label: 'En retard', count: count('late') },
          { value: 'blocked', label: 'Bloqués', count: count('blocked') },
          { value: 'pin', label: 'PIN à créer', count: count('pin') },
        ]}
      />

      <AsyncContent query={query}>
        {(members) => {
          const visible = members.filter(FILTERS[filter]);
          if (visible.length === 0) {
            return (
              <EmptyState
                title="Aucun membre"
                description="Aucun compte ne correspond à cette recherche."
              />
            );
          }
          return (
            <Card>
              <div
                className={`hidden gap-3 border-b border-line px-2 pb-2 text-small uppercase tracking-wide text-muted md:grid ${COLUMNS}`}
                aria-hidden="true"
              >
                <span>Membre</span>
                <span>Rôle</span>
                <span>Groupes</span>
                <span>Retards</span>
                <span>Statut</span>
                <span />
              </div>
              <ul className="divide-y divide-line">
                {visible.map(({ user, groupCount, lateCount, pinPending }) => (
                  <li key={user.id}>
                    <Link
                      to={`/admin/membres/${user.id}`}
                      className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-control px-2 py-3 transition-colors duration-150 hover:bg-blue-50 ${COLUMNS}`}
                    >
                      <span className="flex min-w-0 items-center gap-3 md:order-1">
                        <Avatar name={fullName(user)} src={user.avatarUrl} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate font-bold text-ink">
                            {fullName(user)}
                          </span>
                          <span className="block text-small tabular-nums text-muted">
                            {formatPhone(user.phone)}
                          </span>
                        </span>
                      </span>
                      <span className="flex flex-wrap justify-end gap-1 md:order-5 md:justify-start">
                        <Badge tone={user.isSuspended ? 'danger' : 'success'}>
                          {user.isSuspended ? 'Bloqué' : 'Actif'}
                        </Badge>
                        {pinPending ? (
                          <Badge
                            tone="info"
                            icon={<KeyRound className="h-3.5 w-3.5" aria-hidden="true" />}
                          >
                            PIN
                          </Badge>
                        ) : null}
                      </span>
                      <span className="text-label text-muted md:order-2">
                        {user.globalRole === 'admin' ? 'Administrateur' : 'Participant'}
                      </span>
                      <span className="justify-self-end text-label tabular-nums text-ink md:order-3 md:justify-self-auto">
                        {plural(groupCount, 'groupe')}
                      </span>
                      <span className="text-label tabular-nums md:order-4">
                        {lateCount > 0 ? (
                          <span className="font-bold text-warning">
                            {plural(lateCount, 'retard')}
                          </span>
                        ) : (
                          <span className="text-muted">Aucun retard</span>
                        )}
                      </span>
                      <ChevronRight
                        className="hidden h-5 w-5 text-muted md:order-6 md:block"
                        aria-hidden="true"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          );
        }}
      </AsyncContent>

      <AccountFormDialog kind="member" open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
