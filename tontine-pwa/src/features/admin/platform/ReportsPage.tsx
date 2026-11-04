import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, startOfMonth } from 'date-fns';
import { Download } from 'lucide-react';
import { Button, Card, Input } from '@/components/ui';
import { downloadCsv } from '@/lib/csv';
import { formatDate } from '@/lib/format';
import { reportService } from '@/services';
import type { PlatformReport } from '@/types';
import { PageFrame, QueryState, Stat } from './PlatformUi';
import { MonthlyTable, ReportTable } from './ReportTables';
import { money } from './labels';

const currentMonth = new Date();
const defaultFrom = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
const defaultTo = format(currentMonth, 'yyyy-MM-dd');

/** Exporte le bilan affiché dans un fichier lisible par Excel. */
function exportReport(data: PlatformReport, from: string, to: string) {
  downloadCsv(
    [
      ['Période', data.from, data.to],
      [],
      ['Indicateur', 'Valeur'],
      ['Attendu', data.totals.expected],
      ['Collecté', data.totals.collected],
      ['Taux', data.totals.rate ?? '—'],
      ['Retards', data.totals.lateAmount],
      ['Versé', data.totals.paidOut],
      ['Membres', data.totals.members],
      ['Nouveaux membres', data.totals.newMembers],
      [],
      ['Groupe', 'Attendu', 'Collecté', 'Taux', 'Retards', 'Versé'],
      ...data.byGroup.map((row) => [
        row.label,
        row.expected,
        row.collected,
        row.rate ?? '—',
        row.lateAmount,
        row.paidOut,
      ]),
    ],
    `rapport-${from}-${to}.csv`,
  );
}

export function ReportsPage() {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [applied, setApplied] = useState({ from: defaultFrom, to: defaultTo });
  const report = useQuery({
    queryKey: ['admin', 'report', applied.from, applied.to],
    queryFn: () => reportService.report(applied.from, applied.to),
  });
  const invalid = !from || !to || from > to;
  // Dates modifiées mais pas encore appliquées : on le signale près du bouton.
  const pending = from !== applied.from || to !== applied.to;

  return (
    <PageFrame
      title="Rapports et statistiques"
      subtitle="Bilans de collecte, de recouvrement et d’activité sur une période."
    >
      <Card className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end">
          <Input
            label="Du"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
          <Input
            label="Au"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
          <Button
            variant="blue"
            className="col-span-2 sm:col-span-1"
            disabled={invalid}
            loading={report.isFetching}
            onClick={() => (pending ? setApplied({ from, to }) : void report.refetch())}
          >
            Afficher le rapport
          </Button>
          <Button
            variant="outline"
            className="col-span-2 sm:col-span-1"
            disabled={!report.data}
            onClick={() => report.data && exportReport(report.data, applied.from, applied.to)}
            icon={<Download className="h-4 w-4" aria-hidden="true" />}
          >
            Exporter CSV
          </Button>
        </div>
        <p className="text-label text-muted" aria-live="polite">
          {invalid
            ? 'La date de début doit précéder la date de fin.'
            : pending
              ? 'Dates modifiées : appuyez sur « Afficher le rapport ».'
              : `Rapport du ${formatDate(applied.from)} au ${formatDate(applied.to)}.`}
        </p>
      </Card>
      <QueryState query={report}>
        {report.data ? (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Collecté" value={money(report.data.totals.collected)} />
              <Stat label="Attendu" value={money(report.data.totals.expected)} />
              <Stat
                label="Recouvrement"
                value={report.data.totals.rate === null ? '—' : `${report.data.totals.rate} %`}
              />
              <Stat
                label="Membres · nouveaux"
                value={`${report.data.totals.members} · +${report.data.totals.newMembers}`}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Retards" value={money(report.data.totals.lateAmount)} />
              <Stat label="Versements effectués" value={money(report.data.totals.paidOut)} />
            </div>
            <ReportTable title="Bilan par groupe" rows={report.data.byGroup} />
            <ReportTable title="Bilan par administrateur" rows={report.data.byAdmin} />
            <MonthlyTable report={report.data} />
          </>
        ) : null}
      </QueryState>
    </PageFrame>
  );
}
