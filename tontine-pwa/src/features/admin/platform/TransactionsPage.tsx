import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { Button, Card, CardTitle, Input, Select } from '@/components/ui';
import { queryKeys } from '@/lib/query';
import { adminService, groupService } from '@/services';
import { CollapsibleFilters } from '../components/ListToolbar';
import { useShowMore } from '../components/useShowMore';
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
  const transactions = useQuery({
    queryKey: ['admin', 'transactions'],
    queryFn: () => adminService.listTransactions(),
  });
  const groups = useQuery({
    queryKey: queryKeys.managedGroups,
    queryFn: () => groupService.listManaged(),
  });
  const rows = useMemo(
    () =>
      (transactions.data ?? []).filter(
        ({ payment, groupId: rowGroupId }) =>
          (!status || payment.status === status) &&
          (!method || payment.method === method) &&
          (!groupId || rowGroupId === groupId) &&
          (!from || (payment.createdAt ?? payment.paidAt ?? '').slice(0, 10) >= from) &&
          (!to || (payment.createdAt ?? payment.paidAt ?? '').slice(0, 10) <= to),
      ),
    [transactions.data, status, method, groupId, from, to],
  );
  const filters = [status, method, groupId, from, to];
  const page = useShowMore(rows, 20, filters.join('|'));

  return (
    <PageFrame
      title="Transactions"
      subtitle="Historique des paiements et rapprochement avec le prestataire."
    >
      <QueryState query={transactions}>
        <>
          {/* Téléphone : le montant sur toute la largeur, les deux compteurs côte à côte. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat
              label="Montant payé"
              className="col-span-2 sm:col-span-1"
              value={money(
                rows
                  .filter((row) => row.payment.status === 'paid')
                  .reduce((sum, row) => sum + row.payment.amount, 0),
              )}
            />
            <Stat label="Transactions affichées" value={rows.length} />
            <Stat
              label="En attente / en échec"
              value={
                rows.filter((row) => ['pending', 'failed'].includes(row.payment.status)).length
              }
            />
          </div>
          <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <CardTitle>Historique des paiements</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => transactionCsv(rows)}
                icon={<Download className="h-4 w-4" aria-hidden="true" />}
              >
                Exporter CSV
              </Button>
            </div>
            <CollapsibleFilters
              activeCount={filters.filter(Boolean).length}
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
              <>
                {/* Téléphone et tablette : lignes compactes ; ordinateur : tableau complet. */}
                <div className="lg:hidden">
                  <TransactionList rows={page.visible} detailed />
                </div>
                <div className="hidden lg:block">
                  <TransactionsTable rows={page.visible} />
                </div>
                {page.more}
              </>
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
