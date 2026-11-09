import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Card, CardTitle, Input, Select } from '@/components/ui';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import { queryKeys } from '@/lib/query';
import { adminService, groupService } from '@/services';
import type { PaymentMethod, PaymentStatus, TransactionFilters } from '@/types';
import { CollapsibleFilters } from '../components/ListToolbar';
import { fetchAllPages, useServerList } from '../components/useServerList';
import { TransactionList } from '../super/TransactionsCard';
import { PageFrame, QueryState, Stat } from './PlatformUi';
import { ReconciliationCard } from './ReconciliationCard';
import { TransactionsTable } from './TransactionsTable';
import { money, transactionCsv } from './labels';

export function TransactionsPage() {
  const [status, setStatus] = useState('');
  const [method, setMethod] = useState('');
  const [groupId, setGroupId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [exporting, setExporting] = useState(false);
  // Filtres appliqués par le serveur : seules les lignes retenues sont envoyées.
  const filters: TransactionFilters = {
    status: (status || undefined) as PaymentStatus | undefined,
    method: (method || undefined) as PaymentMethod | undefined,
    groupId: groupId || undefined,
    from: from || undefined,
    to: to || undefined,
  };
  const list = useServerList(['admin', 'transactions', filters], (cursor, limit) =>
    adminService.transactionsPage(filters, cursor, limit),
  );
  const groups = useQuery({
    queryKey: queryKeys.managedGroups,
    queryFn: () => groupService.listManaged(),
  });
  const rows = list.rows;
  const activeFilters = [status, method, groupId, from, to];

  const exportCsv = async () => {
    setExporting(true);
    try {
      transactionCsv(
        await fetchAllPages((cursor, limit) =>
          adminService.transactionsPage(filters, cursor, limit),
        ),
      );
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setExporting(false);
    }
  };

  return (
    <PageFrame
      title="Transactions"
      subtitle="Historique des paiements et rapprochement avec le prestataire."
    >
      <QueryState query={list.query}>
        <>
          {/* Téléphone : le montant sur toute la largeur, les deux compteurs côte à côte. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat
              label="Montant payé"
              className="col-span-2 sm:col-span-1"
              value={money(list.summary?.paidAmount ?? 0)}
            />
            <Stat label="Transactions" value={list.summary?.total ?? 0} />
            <Stat label="En attente / en échec" value={list.summary?.openCount ?? 0} />
          </div>
          <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <CardTitle>Historique des paiements</CardTitle>
              <Button
                variant="outline"
                size="sm"
                disabled={!rows.length}
                loading={exporting}
                onClick={() => void exportCsv()}
                icon={<Download className="h-4 w-4" aria-hidden="true" />}
              >
                Exporter CSV
              </Button>
            </div>
            <CollapsibleFilters
              activeCount={activeFilters.filter(Boolean).length}
              className="grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5"
            >
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
              <Select
                label="Statut"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                options={[
                  { value: 'paid', label: 'Réussie' },
                  { value: 'pending', label: 'En attente' },
                  { value: 'failed', label: 'Échouée' },
                  { value: 'late', label: 'En retard' },
                  { value: 'refunded', label: 'Remboursée' },
                ]}
                placeholder="Tous les statuts"
              />
              <Select
                label="Moyen de paiement"
                value={method}
                onChange={(event) => setMethod(event.target.value)}
                options={[
                  { value: 'wave', label: 'Wave' },
                  { value: 'orange_money', label: 'Orange Money' },
                  { value: 'free_money', label: 'Free Money' },
                  { value: 'cash', label: 'Espèces' },
                ]}
                placeholder="Tous les moyens"
              />
              <Select
                label="Groupe"
                value={groupId}
                onChange={(event) => setGroupId(event.target.value)}
                options={(groups.data ?? []).map(({ group }) => ({
                  value: group.id,
                  label: group.name,
                }))}
                placeholder="Tous les groupes"
              />
            </CollapsibleFilters>
            {rows.length ? (
              <div className={cn('flex flex-col gap-4', list.updating && 'opacity-60')}>
                {/* Téléphone et tablette : lignes compactes ; ordinateur : tableau complet. */}
                <div className="lg:hidden">
                  <TransactionList rows={rows} detailed />
                </div>
                <div className="hidden lg:block">
                  <TransactionsTable rows={rows} />
                </div>
                {list.more}
              </div>
            ) : (
              <p className="text-muted">Aucune transaction ne correspond à ces filtres.</p>
            )}
          </Card>
        </>
      </QueryState>
      <ReconciliationCard />
    </PageFrame>
  );
}
