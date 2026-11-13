import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { AsyncContent, Avatar, Badge, Button, Card, EmptyState, Input, Select } from '@/components/ui';
import { formatDate, plural } from '@/lib/format';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { organizationService } from '@/services';
import type { OrgMemberStatus, StructureMemberStatus } from '@/types';
import { orgKeys, useOrganizations } from './queries';

const STATUS: Record<OrgMemberStatus, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  active: { label: 'Actif', tone: 'success' },
  pending: { label: 'En attente', tone: 'warning' },
  suspended: { label: 'Suspendu', tone: 'danger' },
  left: { label: 'Parti', tone: 'neutral' },
};

const STRUCTURE_STATUS: Partial<Record<StructureMemberStatus, string>> = {
  pending: 'en attente',
};

/**
 * /admin/organisations/:id/militants : fichier des militants d'une organisation, en
 * lecture pour le super admin (nom, téléphone, numéro, statut, structures, lieu).
 */
export default function OrgMembersPage() {
  const { id = '' } = useParams();
  const organizations = useOrganizations();
  const organization = organizations.data?.find((o) => o.id === id);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<OrgMemberStatus | ''>('');
  const [offset, setOffset] = useState(0);
  const query = useDebouncedValue(search.trim(), 300);

  const members = useQuery({
    queryKey: [...orgKeys.all, 'members', id, query, status, offset],
    queryFn: () =>
      organizationService.membersPage({
        organizationId: id,
        query: query || undefined,
        status: status || undefined,
        offset,
      }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={organization ? `Militants ${organization.shortName}` : 'Militants'}
        subtitle={organization?.name}
        backTo="/admin/organisations"
      />

      <Card className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <Input
          label="Rechercher"
          placeholder="Nom, téléphone ou numéro de membre"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
        />
        <Select
          label="Statut"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as OrgMemberStatus | '');
            setOffset(0);
          }}
          options={[
            { value: '', label: 'Tous' },
            ...(Object.keys(STATUS) as OrgMemberStatus[]).map((value) => ({
              value,
              label: STATUS[value].label,
            })),
          ]}
        />
      </Card>

      <AsyncContent query={members}>
        {(page) =>
          page.rows.length === 0 ? (
            <EmptyState
              title="Aucun militant"
              description={
                query || status
                  ? 'Aucun militant ne correspond à cette recherche.'
                  : 'Personne n’est encore inscrit dans cette organisation.'
              }
            />
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-label text-muted">
                {plural(page.total, 'militant', 'militants')}
                {page.total > page.pageSize
                  ? ` · ${offset + 1} à ${Math.min(offset + page.pageSize, page.total)}`
                  : ''}
              </p>
              <ul className="flex flex-col gap-2">
                {page.rows.map((m) => {
                  const place = [m.commune, m.departement, m.region].filter(Boolean).join(', ');
                  return (
                    <li key={m.id}>
                      <Card className="flex items-start gap-3">
                        <Avatar
                          name={`${m.firstName} ${m.lastName}`}
                          src={m.avatarUrl ?? undefined}
                        />
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-ink">
                              {m.firstName} {m.lastName.toUpperCase()}
                            </span>
                            <Badge tone={STATUS[m.status].tone}>{STATUS[m.status].label}</Badge>
                          </div>
                          <p className="text-label text-muted">
                            +221 {m.phone}
                            {m.memberNumber ? ` · ${m.memberNumber}` : ''}
                            {m.joinedAt ? ` · membre depuis le ${formatDate(m.joinedAt)}` : ''}
                          </p>
                          {m.structures.length > 0 ? (
                            <p className="text-label text-ink">
                              {m.structures
                                .map((s) =>
                                  STRUCTURE_STATUS[s.status]
                                    ? `${s.name} (${STRUCTURE_STATUS[s.status]})`
                                    : s.name,
                                )
                                .join(' · ')}
                            </p>
                          ) : null}
                          {place ? <p className="text-small text-muted">{place}</p> : null}
                        </div>
                      </Card>
                    </li>
                  );
                })}
              </ul>
              {page.total > page.pageSize ? (
                <div className="flex justify-between gap-2">
                  <Button
                    variant="secondary"
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - page.pageSize))}
                  >
                    Précédents
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={offset + page.pageSize >= page.total}
                    onClick={() => setOffset(offset + page.pageSize)}
                  >
                    Suivants
                  </Button>
                </div>
              ) : null}
            </div>
          )
        }
      </AsyncContent>
    </div>
  );
}
