import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Card, CardTitle } from '@/components/ui';
import type { PlatformReport } from '@/types';
import { money } from './labels';

const rateLabel = (rate: number | null) => (rate === null ? '—' : `${rate} %`);

/** Une valeur avec son libellé, pour les cartes mobiles. */
function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-small text-muted">{label}</dt>
      <dd className="font-bold tabular-nums text-ink">{value}</dd>
    </div>
  );
}

/**
 * Bilan par groupe ou par administrateur : cartes sur téléphone et tablette,
 * tableau sur ordinateur.
 */
export function ReportTable({ title, rows }: { title: string; rows: PlatformReport['byGroup'] }) {
  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>{title}</CardTitle>
      {rows.length ? (
        <>
          <ul className="divide-y divide-line lg:hidden">
            {rows.map((row) => (
              <li key={row.id} className="py-3">
                <p className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate font-bold text-ink">{row.label}</span>
                  <span className="shrink-0 text-label font-bold text-blue-700">
                    {rateLabel(row.rate)}
                  </span>
                </p>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
                  <Figure label="Collecté" value={money(row.collected)} />
                  <Figure label="Attendu" value={money(row.expected)} />
                  <Figure label="Retards" value={money(row.lateAmount)} />
                  <Figure label="Versé" value={money(row.paidOut)} />
                </dl>
              </li>
            ))}
          </ul>
          <table className="hidden w-full text-left text-label lg:table">
            <thead className="border-b border-line text-small uppercase text-muted">
              <tr>
                <th className="py-2">Nom</th>
                <th>Attendu</th>
                <th>Collecté</th>
                <th>Recouvrement</th>
                <th>Retards</th>
                <th>Versé</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="py-3 font-bold">{row.label}</td>
                  <td>{money(row.expected)}</td>
                  <td>{money(row.collected)}</td>
                  <td>{rateLabel(row.rate)}</td>
                  <td>{money(row.lateAmount)}</td>
                  <td>{money(row.paidOut)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="text-muted">Aucune donnée pour cette période.</p>
      )}
    </Card>
  );
}

/** Évolution mois par mois : cartes sur téléphone et tablette, tableau sur ordinateur. */
export function MonthlyTable({ report }: { report: PlatformReport }) {
  const months = report.monthly.map((month, index) => ({
    ...month,
    label: format(new Date(month.month), 'MMMM yyyy', { locale: fr }),
    rate: month.expected ? Math.round((month.collected / month.expected) * 100) : null,
    added: report.members[index]?.added ?? 0,
    total: report.members[index]?.total ?? 0,
  }));
  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>Évolution mensuelle</CardTitle>
      {months.length ? (
        <>
          <ul className="divide-y divide-line lg:hidden">
            {months.map((month) => (
              <li key={month.month} className="py-3">
                <p className="flex items-baseline justify-between gap-3">
                  <span className="font-bold capitalize text-ink">{month.label}</span>
                  <span className="text-label font-bold text-blue-700">
                    {rateLabel(month.rate)}
                  </span>
                </p>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
                  <Figure label="Collecté" value={money(month.collected)} />
                  <Figure label="Attendu" value={money(month.expected)} />
                  <Figure label="Nouveaux membres" value={String(month.added)} />
                  <Figure label="Total membres" value={String(month.total)} />
                </dl>
              </li>
            ))}
          </ul>
          <table className="hidden w-full text-left text-label lg:table">
            <thead className="border-b border-line text-small uppercase text-muted">
              <tr>
                <th className="py-2">Mois</th>
                <th>Attendu</th>
                <th>Collecté</th>
                <th>Taux</th>
                <th>Nouveaux membres</th>
                <th>Total membres</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {months.map((month) => (
                <tr key={month.month}>
                  <td className="py-3 capitalize">{month.label}</td>
                  <td>{money(month.expected)}</td>
                  <td>{money(month.collected)}</td>
                  <td>{rateLabel(month.rate)}</td>
                  <td>{month.added}</td>
                  <td>{month.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="text-muted">Aucune donnée mensuelle.</p>
      )}
    </Card>
  );
}
