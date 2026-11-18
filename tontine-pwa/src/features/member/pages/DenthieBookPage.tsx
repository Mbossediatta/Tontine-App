// Carnet électronique d'un membre de Denthie : logo et informations du groupe, nom du
// membre, et tous ses versements. Ouvert après le paiement des frais d'adhésion ; il
// s'imprime ou s'enregistre en PDF (bouton « Télécharger »).
import { ChevronLeft, Download } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { BrandLogo, GroupPhoto } from '@/components/ui';
import { useGroup, useMyHistory, useRounds } from '@/features/groups/queries';
import { useCurrentUser } from '@/hooks/useAuth';
import { bookUnlocked, denthieDurationLabel, isDenthie, isPeriod } from '@/lib/denthie';
import {
  formatDate,
  formatPhone,
  frequencyLabel,
  fullName,
  paymentMethodLabel,
} from '@/lib/format';
import { AmountDisplay } from '../ui/AmountDisplay';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { EmptyState, ErrorBlock } from '../ui/EmptyState';
import { ListSkeleton } from '../ui/Skeleton';

// À l'impression, seul le carnet est imprimé (menus et boutons masqués).
const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  #carnet, #carnet * { visibility: visible !important; }
  #carnet { position: absolute; inset: 0 auto auto 0; width: 100%; border: 0; }
  .carnet-actions { display: none !important; }
}`;

export default function DenthieBookPage() {
  const { id = '' } = useParams();
  const user = useCurrentUser();
  const query = useGroup(id);
  const history = useMyHistory(id);
  const rounds = useRounds(id);

  if (query.isPending || history.isPending || rounds.isPending) return <ListSkeleton rows={6} />;
  if (query.isError || !query.data) return <ErrorBlock onRetry={() => void query.refetch()} />;
  const overview = query.data;
  const back = (
    <Link
      to={`/groupes/${id}`}
      className="carnet-actions -ml-2 flex min-h-[44px] items-center gap-1 self-start rounded-lg px-2 text-[13px] font-semibold text-blue-700 hover:bg-blue-50"
    >
      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      {overview.group.name}
    </Link>
  );
  if (!isDenthie(overview.group)) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <EmptyState title="Pas de carnet" description="Le carnet est réservé aux Denthie." />
      </div>
    );
  }
  if (!bookUnlocked(overview)) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <EmptyState
          title="Carnet pas encore ouvert"
          description="Il s’ouvre après le paiement des frais d’adhésion, avec votre première cotisation."
        />
      </div>
    );
  }

  const { group } = overview;
  const cycleRounds = (rounds.data ?? []).map((view) => view.round);
  const periods = cycleRounds.filter(isPeriod).sort((a, b) => a.number - b.number);
  const periodOf = new Map(periods.map((round, index) => [round.id, index + 1]));
  const lines = (history.data?.payments ?? [])
    .filter(
      ({ payment, cycle }) =>
        cycle === group.currentCycle && payment.status === 'paid' && periodOf.has(payment.roundId),
    )
    .sort((a, b) => (a.payment.paidAt ?? '').localeCompare(b.payment.paidAt ?? ''));
  const totals = lines.reduce(
    (sum, { payment }) => ({
      saved: sum.saved + (payment.contributionAmount ?? 0),
      penalties: sum.penalties + (payment.latePenaltyAmount ?? 0),
      fees: sum.fees + (payment.membershipFeeAmount ?? 0),
    }),
    { saved: 0, penalties: 0, fees: 0 },
  );
  const facts: Array<[string, React.ReactNode]> = [
    ...(overview.communityName ? [['Communauté', overview.communityName] as [string, string]] : []),
    ['Administrateur', overview.adminName],
    ['Cotisation', <AmountDisplay key="c" value={group.contributionAmount} />],
    ['Rythme', frequencyLabel(group.frequency)],
    ['Démarrage', formatDate(group.startDate)],
    ['Répartition', group.endDate ? formatDate(group.endDate) : 'Date à fixer'],
    ['Durée', denthieDurationLabel(group)],
  ];

  return (
    <div className="flex flex-col gap-4">
      <style>{PRINT_CSS}</style>
      {back}
      <Card id="carnet" className="flex flex-col gap-5 p-5">
        <header className="flex items-center justify-between gap-4">
          <GroupPhoto name={group.name} src={group.photoUrl} size="lg" />
          <BrandLogo variant="mark" className="h-10 w-auto" />
        </header>
        <div>
          <p className="text-[13px] font-semibold uppercase tracking-wide text-blue-700">
            Carnet Denthie · cycle {group.currentCycle}
          </p>
          <h1 className="text-[22px] font-bold leading-7 text-slate-900">{group.name}</h1>
          {group.description ? (
            <p className="text-[13px] text-slate-600">{group.description}</p>
          ) : null}
        </div>
        <div className="rounded-lg bg-blue-50 px-4 py-3">
          <p className="text-[13px] text-slate-600">Titulaire</p>
          <p className="text-[18px] font-bold text-slate-900">{fullName(user)}</p>
          <p className="text-[13px] text-slate-600">{formatPhone(user.phone)}</p>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt className="text-[13px] text-slate-600">{label}</dt>
              <dd className="text-[15px] font-semibold text-slate-900">{value}</dd>
            </div>
          ))}
        </dl>

        <section aria-labelledby="carnet-lines" className="flex flex-col gap-2">
          <h2 id="carnet-lines" className="text-[15px] font-semibold text-slate-900">
            Mes versements
          </h2>
          {lines.length === 0 ? (
            <p className="text-[13px] text-slate-600">Aucun versement pour l’instant.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-[13px]">
                <thead className="border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2 pr-2 font-semibold">Date</th>
                    <th className="py-2 pr-2 font-semibold">Période</th>
                    <th className="py-2 pr-2 font-semibold">Moyen · réf.</th>
                    <th className="py-2 text-right font-semibold">Épargné</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lines.map(({ payment }) => (
                    <tr key={payment.id}>
                      <td className="py-2 pr-2">
                        {payment.paidAt ? formatDate(payment.paidAt) : '—'}
                      </td>
                      <td className="py-2 pr-2">{periodOf.get(payment.roundId)}</td>
                      <td className="py-2 pr-2 text-slate-600">
                        {paymentMethodLabel(payment.method)}
                        {payment.providerRef ? ` · ${payment.providerRef}` : ''}
                        {payment.latePenaltyAmount ? (
                          <span className="block">
                            pénalité <AmountDisplay value={payment.latePenaltyAmount} />
                          </span>
                        ) : null}
                        {payment.membershipFeeAmount ? (
                          <span className="block">
                            frais d’adhésion <AmountDisplay value={payment.membershipFeeAmount} />
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 text-right">
                        <AmountDisplay value={payment.contributionAmount ?? 0} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <dl className="flex flex-col gap-1 border-t border-slate-200 pt-3">
          <div className="flex justify-between gap-4">
            <dt className="text-[15px] font-semibold text-slate-900">Total épargné</dt>
            <dd>
              <AmountDisplay value={totals.saved} size="md" className="text-green-700" />
            </dd>
          </div>
          {totals.penalties > 0 ? (
            <div className="flex justify-between gap-4 text-[13px] text-slate-600">
              <dt>Pénalités payées (non épargnées)</dt>
              <dd>
                <AmountDisplay value={totals.penalties} />
              </dd>
            </div>
          ) : null}
          {totals.fees > 0 ? (
            <div className="flex justify-between gap-4 text-[13px] text-slate-600">
              <dt>Frais d’adhésion payés</dt>
              <dd>
                <AmountDisplay value={totals.fees} />
              </dd>
            </div>
          ) : null}
        </dl>
        <p className="text-[12px] text-slate-500">
          Édité le {formatDate(new Date())} par Calebasse de l’Espoir. Seuls les paiements confirmés
          figurent dans ce carnet.
        </p>
      </Card>
      <Button
        block
        className="carnet-actions"
        icon={<Download className="h-5 w-5" aria-hidden="true" />}
        onClick={() => window.print()}
      >
        Télécharger (PDF) ou imprimer
      </Button>
    </div>
  );
}
