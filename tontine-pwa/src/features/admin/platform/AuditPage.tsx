import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Input, Select } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { reportService } from '@/services';
import { CollapsibleFilters } from '../components/ListToolbar';
import { useShowMore } from '../components/useShowMore';
import { PageFrame, QueryState } from './PlatformUi';

export function AuditPage() {
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const audit = useQuery({ queryKey: ['admin', 'audit'], queryFn: () => reportService.auditLog() });
  const filtered = (audit.data ?? []).filter(
    ({ entry, actorName }) =>
      (!search ||
        `${actorName} ${entry.summary}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) &&
      (!action || entry.action === action) &&
      (!from || entry.at.slice(0, 10) >= from) &&
      (!to || entry.at.slice(0, 10) <= to),
  );
  const filters = [search, action, from, to];
  // Le journal grossit à chaque action : 30 lignes, puis « Voir plus ».
  const page = useShowMore(filtered, 30, filters.join('|'));
  return (
    <PageFrame
      title="Journal d’audit"
      subtitle="Historique chronologique des actions sensibles de la plateforme."
    >
      <Card className="flex flex-col gap-4">
        <CollapsibleFilters
          activeCount={filters.filter(Boolean).length}
          className="grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          <Input
            label="Rechercher"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Select
            label="Type d’action"
            value={action}
            onChange={(event) => setAction(event.target.value)}
            options={Array.from(new Set((audit.data ?? []).map(({ entry }) => entry.action))).map(
              (value) => ({ value, label: value.replaceAll('_', ' ') }),
            )}
            placeholder="Toutes les actions"
          />
          <Input
            label="À partir du"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
          <Input
            label="Jusqu’au"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </CollapsibleFilters>
        <QueryState query={audit}>
          {filtered.length ? (
            <>
              <p className="text-label text-muted">
                {filtered.length} action{filtered.length > 1 ? 's' : ''}
              </p>
              <ol className="divide-y divide-line">
                {page.visible.map(({ entry, actorName }) => (
                  <li key={entry.id} className="flex gap-3 py-4">
                    <span
                      className="mt-2 h-2 w-2 shrink-0 rounded-full bg-blue-700"
                      aria-hidden="true"
                    />
                    <div>
                      <p>
                        <strong>{actorName}</strong> {entry.summary}
                      </p>
                      <time className="text-small text-muted" dateTime={entry.at}>
                        {formatDateTime(entry.at)}
                      </time>
                    </div>
                  </li>
                ))}
              </ol>
              {page.more}
            </>
          ) : (
            <p className="text-muted">Aucune action ne correspond aux filtres.</p>
          )}
        </QueryState>
      </Card>
    </PageFrame>
  );
}
