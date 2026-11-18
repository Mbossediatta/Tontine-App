// Carnet électronique d'un membre de Denthie : logo et informations du groupe, nom du
// membre, et tous ses versements ; téléchargeable en PDF d'un appui.
// - /groupes/:id/carnet : mon carnet, ouvert après le paiement des frais d'adhésion ;
// - /admin/groupes/:id/carnet/:userId : le carnet d'un membre, pour l'administrateur.
import { ChevronLeft, Download, Printer } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { BrandLogo, GroupPhoto } from '@/components/ui';
import {
  useGroup,
  useMemberPayments,
  useMembers,
  useMyHistory,
  useRounds,
} from '@/features/groups/queries';
import { useCurrentUser } from '@/hooks/useAuth';
import { bookUnlocked, denthieDurationLabel, isDenthie } from '@/lib/denthie';
import {
  formatDate,
  formatPhone,
  frequencyLabel,
  fullName,
  paymentMethodLabel,
} from '@/lib/format';
import { downloadPdf } from '@/lib/pdf';
import { bookFileName, bookLines, buildBookPdf } from '../denthieBook';
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
  const { id = '', userId } = useParams();
  const me = useCurrentUser();
  // Vue de l'administrateur : le carnet d'un membre donné ; sinon le mien.
  const adminView = Boolean(userId);
  const holderId = userId ?? me.id;
  const query = useGroup(id);
  const rounds = useRounds(id);
  const mine = useMyHistory(id);
  const theirs = useMemberPayments(id, adminView ? holderId : '');
  const members = useMembers(id);
  const history = adminView ? theirs : mine;

  if (query.isPending || history.isPending || rounds.isPending) return <ListSkeleton rows={6} />;
  if (query.isError || !query.data) return <ErrorBlock onRetry={() => void query.refetch()} />;
  if (history.isError) return <ErrorBlock onRetry={() => void history.refetch()} />;
  const overview = query.data;
  const back = (
    <Link
      to={adminView ? `/admin/groupes/${id}?onglet=tours` : `/groupes/${id}`}
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
  if (!adminView && !bookUnlocked(overview)) {
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
  const holder = adminView
    ? members.data?.find((member) => member.user.id === holderId)?.user
    : { ...me, phone: me.phone };
  const holderName = holder ? fullName(holder) : 'Membre';
  const payments = adminView ? (theirs.data ?? []) : (mine.data?.payments ?? []);
  const { lines, totals } = bookLines(
    group,
    (rounds.data ?? []).map((view) => view.round),
    payments,
  );
  const facts: Array<[string, string]> = [
    ...(overview.communityName ? [['Communauté', overview.communityName] as [string, string]] : []),
    ['Administrateur', overview.adminName],
    ['Versement', `${group.contributionAmount.toLocaleString('fr-FR')} FCFA`],
    ['Rythme', frequencyLabel(group.frequency)],
    ['Démarrage', formatDate(group.startDate)],
    ['Répartition', group.endDate ? formatDate(group.endDate) : 'Date à fixer'],
    ['Durée', denthieDurationLabel(group)],
  ];
  const download = () =>
    downloadPdf(
      buildBookPdf({
        groupName: group.name,
        groupDescription: group.description,
        photoUrl: group.photoUrl,
        cycle: group.currentCycle,
        holderName,
        holderPhone: holder?.phone,
        facts,
        lines,
        totals,
      }),
      bookFileName(group.name, holderName),
    );

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
          <p className="text-[18px] font-bold text-slate-900">{holderName}</p>
          {holder?.phone ? (
            <p className="text-[13px] text-slate-600">{formatPhone(holder.phone)}</p>
          ) : null}
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
            {adminView ? 'Versements' : 'Mes versements'}
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
                  {lines.map((line) => (
                    <tr key={line.paymentId}>
                      <td className="py-2 pr-2">{line.paidAt ? formatDate(line.paidAt) : '—'}</td>
                      <td className="py-2 pr-2">{line.period}</td>
                      <td className="py-2 pr-2 text-slate-600">
                        {paymentMethodLabel(line.method)}
                        {line.providerRef ? ` · ${line.providerRef}` : ''}
                        {line.penalty ? (
                          <span className="block">
                            pénalité <AmountDisplay value={line.penalty} />
                          </span>
                        ) : null}
                        {line.fee ? (
                          <span className="block">
                            frais d’adhésion <AmountDisplay value={line.fee} />
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 text-right">
                        <AmountDisplay value={line.saved} />
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
      <div className="carnet-actions flex flex-col gap-2 sm:flex-row">
        <Button block icon={<Download className="h-5 w-5" aria-hidden="true" />} onClick={download}>
          Télécharger le carnet (PDF)
        </Button>
        <Button
          block
          variant="secondary"
          icon={<Printer className="h-5 w-5" aria-hidden="true" />}
          onClick={() => window.print()}
        >
          Imprimer
        </Button>
      </div>
    </div>
  );
}
