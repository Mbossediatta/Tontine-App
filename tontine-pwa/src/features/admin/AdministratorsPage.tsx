import { useMemo, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { OnlineButton } from '@/components/layout/OnlineButton';
import { AsyncContent, Card, EmptyState } from '@/components/ui';
import { env } from '@/lib/env';
import { fullName, plural, searchable } from '@/lib/format';
import { AccountFormDialog } from './components/AccountFormDialog';
import { FilterChips, SearchField } from './components/ListToolbar';
import { Paged } from './components/Paged';
import { useAdmins } from './queries';
import { AdminTable } from './super/AdminsCard';

type StatusFilter = 'all' | 'active' | 'suspended';

/**
 * Rubrique « Administrateurs » du super administrateur : liste avec recherche
 * (nom ou numéro) et filtre par statut ; chaque ligne mène à la fiche de l'admin.
 */
export default function AdministratorsPage() {
  const admins = useAdmins();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');

  const counts = useMemo(() => {
    const list = admins.data ?? [];
    const suspended = list.filter((a) => a.user.isSuspended).length;
    return { all: list.length, suspended, active: list.length - suspended };
  }, [admins.data]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Administrateurs"
        plain
        subtitle={`${plural(counts.active, 'actif')} · ${plural(counts.suspended, 'suspendu')}`}
        actions={
          <OnlineButton
            variant="blue"
            size="sm"
            onClick={() => setCreating(true)}
            icon={<UserPlus className="h-4 w-4" aria-hidden="true" />}
          >
            Nouvel admin
          </OnlineButton>
        }
      />

      <SearchField
        value={search}
        onChange={setSearch}
        placeholder="Rechercher par nom ou numéro…"
      />
      <FilterChips
        label="Filtrer par statut"
        value={status}
        onChange={setStatus}
        options={[
          { value: 'all', label: 'Tous', count: counts.all },
          { value: 'active', label: 'Actifs', count: counts.active },
          { value: 'suspended', label: 'Suspendus', count: counts.suspended },
        ]}
      />

      <AsyncContent query={admins}>
        {(list) => {
          const words = searchable(search.trim());
          const digits = search.replace(/\D/g, '');
          const visible = list.filter((admin) => {
            if (status === 'active' && admin.user.isSuspended) return false;
            if (status === 'suspended' && !admin.user.isSuspended) return false;
            if (!words) return true;
            if (digits.length >= 3 && admin.user.phone.includes(digits)) return true;
            return searchable(fullName(admin.user)).includes(words);
          });
          return visible.length === 0 ? (
            <EmptyState
              title="Aucun administrateur"
              description={
                list.length === 0
                  ? env.realAuth
                    ? 'Aucun compte administrateur n’est enregistré dans la base.'
                    : 'Créez le premier administrateur avec son numéro de téléphone.'
                  : 'Aucun administrateur ne correspond à ces critères.'
              }
              action={
                <OnlineButton
                  variant="blue"
                  onClick={() => setCreating(true)}
                  icon={<UserPlus className="h-4 w-4" aria-hidden="true" />}
                >
                  Créer un administrateur
                </OnlineButton>
              }
            />
          ) : (
            <Paged items={visible} resetKey={`${status}|${search}`}>
              {(page) => (
                <Card>
                  <AdminTable admins={page} readOnly={env.realAuth} />
                </Card>
              )}
            </Paged>
          );
        }}
      </AsyncContent>

      <AccountFormDialog kind="admin" open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
