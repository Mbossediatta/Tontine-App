import { useMemo, useState } from 'react';
import { format, isSameMonth, startOfMonth, subMonths } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ArrowDownLeft, ArrowUpRight, Download } from 'lucide-react';
import { downloadPaymentReceipt } from '@/features/payments/receipts';
import { useCurrentUser } from '@/hooks/useAuth';
import { cn } from '@/lib/cn';
import { formatDateTime, fullName, paymentMethodLabel } from '@/lib/format';
import type { MyTransaction } from '@/types';
import { useMyTransactions } from '../queries';
import { shortDate } from '../dues';
import { AmountDisplay } from '../ui/AmountDisplay';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { Card, PageTitle } from '../ui/Card';
import { EmptyState, ErrorBlock } from '../ui/EmptyState';
import { ListSkeleton, Skeleton } from '../ui/Skeleton';
import { StatusPill } from '../ui/StatusPill';

type Period = 'month' | '3m' | '12m' | 'all';

const PERIODS: Array<{ id: Period; label: string }> = [
  { id: 'month', label: 'Ce mois' },
  { id: '3m', label: '3 mois' },
  { id: '12m', label: '12 mois' },
  { id: 'all', label: 'Tout' },
];

/** Date de début de la période (null : depuis toujours). */
function periodStart(period: Period): Date | null {
  const now = new Date();
  if (period === 'month') return startOfMonth(now);
  if (period === '3m') return startOfMonth(subMonths(now, 2));
  if (period === '12m') return startOfMonth(subMonths(now, 11));
  return null;
}

/** « Novembre 2026 » : en-tête de chaque mois dans la liste. */
const monthHeading = (iso: string) => {
  const text = format(new Date(iso), 'MMMM yyyy', { locale: fr });
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** Regroupe les lignes par mois, dans l'ordre (le plus récent d'abord). */
function byMonth(items: MyTransaction[]): Array<{ month: string; items: MyTransaction[] }> {
  const groups: Array<{ month: string; items: MyTransaction[] }> = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && isSameMonth(new Date(last.month), new Date(item.date))) last.items.push(item);
    else groups.push({ month: item.date, items: [item] });
  }
  return groups;
}

/** Une ligne : sens (versé / reçu), libellé, date, montant, statut s'il n'est pas « réussi ». */
function TransactionRow({ item, onOpen }: { item: MyTransaction; onOpen: () => void }) {
  const payout = item.kind === 'payout';
  const status = item.kind === 'contribution' ? item.payment.status : 'paid';
  const amount = item.kind === 'payout' ? item.amount : item.payment.amount;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-[64px] w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-slate-50 active:bg-slate-100"
      >
        <span
          aria-hidden="true"
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
            payout ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-700',
          )}
        >
          {payout ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold">
            {payout ? 'Cagnotte reçue' : 'Cotisation'} · {item.groupName}
          </span>
          <span className="block text-[13px] text-slate-600">
            {shortDate(item.date)} · tour {item.roundNumber}
            {item.kind === 'contribution' ? ` · ${paymentMethodLabel(item.payment.method)}` : ''}
          </span>
        </span>
        <span className="flex flex-col items-end gap-1">
          <AmountDisplay
            value={amount}
            sign={payout ? '+' : '−'}
            className={cn(
              payout ? 'text-green-700' : 'text-slate-900',
              status !== 'paid' && 'text-slate-600 line-through decoration-slate-400',
            )}
          />
          {status !== 'paid' ? <StatusPill status={status} /> : null}
        </span>
      </button>
    </li>
  );
}

/** Détail d'une ligne, avec le reçu pour une cotisation payée. */
function TransactionSheet({ item, onClose }: { item: MyTransaction | null; onClose: () => void }) {
  const user = useCurrentUser();
  if (!item) return null;
  const receipt =
    item.kind === 'contribution' && item.payment.status === 'paid'
      ? {
          paymentId: item.payment.id,
          payerName: fullName(user),
          payerPhone: user.phone,
          groupName: item.groupName,
          cycle: item.cycle,
          roundNumber: item.roundNumber,
          amount: item.payment.amount,
          method: item.payment.method,
          providerRef: item.payment.providerRef,
          paidAt: item.payment.paidAt ?? item.date,
        }
      : null;
  const rows: Array<[string, string]> = [
    ['Groupe', `${item.groupName} · tour ${item.roundNumber}`],
    ['Date', formatDateTime(item.date)],
  ];
  if (item.kind === 'contribution') {
    rows.push(['Moyen', paymentMethodLabel(item.payment.method)]);
    rows.push(['Référence', item.payment.providerRef ?? item.payment.id.toUpperCase()]);
  }
  return (
    <BottomSheet
      open
      onClose={onClose}
      title={item.kind === 'payout' ? 'Cagnotte reçue' : 'Cotisation'}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <AmountDisplay
            value={item.kind === 'payout' ? item.amount : item.payment.amount}
            size="xl"
            className={item.kind === 'payout' ? 'text-green-700' : undefined}
          />
          {item.kind === 'contribution' ? <StatusPill status={item.payment.status} /> : null}
        </div>
        <dl className="divide-y divide-slate-200 border-t border-slate-200">
          {rows.map(([label, value]) => (
            <div key={label} className="flex min-h-[44px] items-center justify-between gap-4 py-2">
              <dt className="text-[13px] text-slate-600">{label}</dt>
              <dd className="text-right text-[15px] font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
        {receipt ? (
          <Button
            variant="secondary"
            block
            icon={<Download className="h-4 w-4" aria-hidden="true" />}
            onClick={() => downloadPaymentReceipt(receipt)}
          >
            Télécharger le reçu
          </Button>
        ) : null}
      </div>
    </BottomSheet>
  );
}

/**
 * Historique : toutes mes cotisations et cagnottes reçues, filtrables par groupe et
 * par période, avec le total cotisé et le total reçu sur la sélection.
 */
export default function HistoryPage() {
  const query = useMyTransactions();
  const [groupId, setGroupId] = useState('');
  const [period, setPeriod] = useState<Period>('12m');
  const [open, setOpen] = useState<MyTransaction | null>(null);

  const all = useMemo(() => query.data ?? [], [query.data]);
  // Groupes présents dans l'historique, pour le filtre.
  const groups = useMemo(
    () => [...new Map(all.map((t) => [t.groupId, t.groupName])).entries()],
    [all],
  );
  const start = periodStart(period);
  const visible = all.filter(
    (t) => (!groupId || t.groupId === groupId) && (!start || new Date(t.date) >= start),
  );
  // Seuls les paiements réussis comptent dans le total cotisé.
  const paidOut = visible
    .filter((t) => t.kind === 'contribution' && t.payment.status === 'paid')
    .reduce((sum, t) => sum + (t.kind === 'contribution' ? t.payment.amount : 0), 0);
  const received = visible.reduce((sum, t) => sum + (t.kind === 'payout' ? t.amount : 0), 0);

  return (
    <div className="flex flex-col gap-4 motion-safe:animate-fade-in">
      <PageTitle>Historique</PageTitle>

      {/* Totaux de la sélection : deux chiffres côte à côte, pas une grille de cartes. */}
      {query.isPending ? (
        <Skeleton className="h-20 rounded-xl" />
      ) : (
        <Card className="grid grid-cols-2 divide-x divide-slate-200">
          <div className="px-4 py-3">
            <p className="text-[13px] text-slate-600">Total cotisé</p>
            <AmountDisplay value={paidOut} size="md" />
          </div>
          <div className="px-4 py-3">
            <p className="text-[13px] text-slate-600">Total reçu</p>
            <AmountDisplay value={received} size="md" className="text-green-700" />
          </div>
        </Card>
      )}

      {/* Filtres : groupe (liste déroulante) et période (segments). */}
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold text-slate-700">Groupe</span>
          <select
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            className="min-h-[48px] rounded-lg border border-slate-300 bg-white px-3 text-[15px] focus:border-blue-700 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-blue-700"
          >
            <option value="">Tous mes groupes</option>
            {groups.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <div role="radiogroup" aria-label="Période" className="grid grid-cols-4 rounded-lg bg-slate-100 p-1">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={period === p.id}
              onClick={() => setPeriod(p.id)}
              className={cn(
                'min-h-[40px] rounded-md text-[13px] font-semibold transition-colors duration-150',
                period === p.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {query.isPending ? (
        <ListSkeleton rows={5} />
      ) : query.isError ? (
        <ErrorBlock onRetry={() => void query.refetch()} />
      ) : visible.length === 0 ? (
        <EmptyState
          title={all.length === 0 ? 'Aucun paiement pour l’instant' : 'Rien sur cette période'}
          description={
            all.length === 0
              ? 'Tes cotisations et les cagnottes reçues apparaîtront ici.'
              : 'Choisis une période plus longue ou un autre groupe.'
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {byMonth(visible).map(({ month, items }) => (
            <section key={month} aria-label={monthHeading(month)}>
              <h2 className="mb-2 text-[13px] font-semibold text-slate-600">{monthHeading(month)}</h2>
              <Card>
                <ul className="divide-y divide-slate-200">
                  {items.map((item) => (
                    <TransactionRow key={item.id} item={item} onOpen={() => setOpen(item)} />
                  ))}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      )}

      <TransactionSheet item={open} onClose={() => setOpen(null)} />
    </div>
  );
}
