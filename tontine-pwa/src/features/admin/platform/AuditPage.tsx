import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { format, isToday, isYesterday, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ChevronRight, Download, FileText, Lock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button, Card, CardTitle, Input, Select } from '@/components/ui';
import { cn } from '@/lib/cn';
import { downloadCsv } from '@/lib/csv';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatDateTime } from '@/lib/format';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { downloadTablePdf } from '@/lib/tablePdf';
import { reportService } from '@/services';
import type { AuditAction, AuditFilters, AuditView } from '@/types';
import { CollapsibleFilters } from '../components/ListToolbar';
import { fetchAllPages, useServerList } from '../components/useServerList';
import { PageFrame, QueryState, Stat } from './PlatformUi';
import {
  auditActionLabel,
  auditActions,
  auditCategories,
  auditCategoryOf,
  type AuditCategory,
} from './auditLabels';

/** « Aujourd’hui », « Hier », sinon « mardi 3 novembre 2026 » : titre d'un jour du journal. */
function dayTitle(day: string): string {
  const date = parseISO(day);
  if (isToday(date)) return 'Aujourd’hui';
  if (isYesterday(date)) return 'Hier';
  const text = format(date, 'EEEE d MMMM yyyy', { locale: fr });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Les lignes affichées, regroupées par jour (le journal est déjà du plus récent au plus ancien). */
function byDay(rows: AuditView[]): [string, AuditView[]][] {
  const days = new Map<string, AuditView[]>();
  for (const row of rows) {
    const day = row.entry.at.slice(0, 10);
    days.set(day, [...(days.get(day) ?? []), row]);
  }
  return [...days];
}

function exportName(extension: string) {
  return `journal-audit-${new Date().toISOString().slice(0, 10)}.${extension}`;
}

function auditCsv(rows: AuditView[]) {
  downloadCsv(
    [
      ['Date', 'Auteur', 'Type d’action', 'Famille', 'Détail'],
      ...rows.map(({ entry, actorName }) => [
        formatDateTime(entry.at),
        actorName,
        auditActionLabel(entry.action),
        auditCategories[auditCategoryOf(entry.action)].label,
        `${actorName} ${entry.summary}`,
      ]),
    ],
    exportName('csv'),
  );
}

function auditPdf(rows: AuditView[], period: string) {
  downloadTablePdf({
    title: 'Journal d’audit',
    subtitle: `${rows.length} action${rows.length > 1 ? 's' : ''} · ${period}`,
    columns: [
      { label: 'Date', weight: 2 },
      { label: 'Auteur', weight: 2 },
      { label: 'Action', weight: 2.5 },
      { label: 'Détail', weight: 6 },
    ],
    rows: rows.map(({ entry, actorName }) => [
      formatDateTime(entry.at),
      actorName,
      auditActionLabel(entry.action),
      entry.summary,
    ]),
    filename: exportName('pdf'),
  });
}

/** Une action : pastille de sa famille, auteur + phrase, type et heure, lien vers le groupe. */
function AuditItem({ row }: { row: AuditView }) {
  const { entry, actorName } = row;
  const category = auditCategoryOf(entry.action);
  return (
    <li className="flex gap-3 py-3">
      <span
        className={cn('mt-2 h-2.5 w-2.5 shrink-0 rounded-full', auditCategories[category].dot)}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="break-words">
          <strong>{actorName}</strong> {entry.summary}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-small text-muted">
          <time dateTime={entry.at}>{format(parseISO(entry.at), 'HH:mm')}</time>
          <span aria-hidden="true">·</span>
          <span>{auditActionLabel(entry.action)}</span>
        </p>
      </div>
      {entry.groupId ? (
        <Link
          to={`/admin/groupes/${entry.groupId}`}
          className="flex min-h-touch shrink-0 items-center gap-1 self-center rounded-control px-2 text-label text-blue-700 hover:bg-blue-50"
        >
          <span className="hidden sm:inline">Voir le groupe</span>
          <span className="sr-only sm:hidden">Voir le groupe</span>
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </Link>
      ) : null}
    </li>
  );
}

export function AuditPage() {
  const [search, setSearch] = useState('');
  const [actorId, setActorId] = useState('');
  const [category, setCategory] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [exporting, setExporting] = useState<'csv' | 'pdf'>();
  // La recherche part au serveur une fois la saisie terminée, pas à chaque lettre.
  const debouncedSearch = useDebouncedValue(search.trim());

  // Types d'action d'une famille (filtre « Famille » sans type précis).
  const categoryActions = useMemo(
    () =>
      (Object.keys(auditActions) as AuditAction[]).filter(
        (value) => auditCategoryOf(value) === category,
      ),
    [category],
  );
  // Filtres appliqués par le serveur : seules les actions retenues sont envoyées.
  const serverFilters: AuditFilters = {
    search: debouncedSearch || undefined,
    actorId: actorId || undefined,
    actions: action ? [action as AuditAction] : category ? categoryActions : undefined,
    from: from || undefined,
    to: to || undefined,
  };
  const audit = useServerList(['admin', 'audit', serverFilters], (cursor, limit) =>
    reportService.auditPage(serverFilters, cursor, limit),
  );
  const filtered = audit.rows;
  const actorList = useQuery({
    queryKey: ['admin', 'audit-actors'],
    queryFn: () => reportService.auditActors(),
  });
  const actors = useMemo(
    () => (actorList.data ?? []).map(({ id, name }) => ({ value: id, label: name })),
    [actorList.data],
  );
  // Types proposés : ceux de la famille choisie (tous si aucune famille).
  const actions = useMemo(
    () =>
      (Object.keys(auditActions) as AuditAction[])
        .filter((value) => !category || auditCategoryOf(value) === category)
        .map((value) => ({ value, label: auditActionLabel(value) }))
        .sort((a, b) => a.label.localeCompare(b.label, 'fr')),
    [category],
  );

  const filters = [search, actorId, category, action, from, to];

  const exportAll = async (kind: 'csv' | 'pdf') => {
    setExporting(kind);
    try {
      const rows = await fetchAllPages((cursor, limit) =>
        reportService.auditPage(serverFilters, cursor, limit),
      );
      if (kind === 'csv') auditCsv(rows);
      else auditPdf(rows, period);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setExporting(undefined);
    }
  };
  const period =
    from || to
      ? `du ${from ? formatDate(from) : 'début'} au ${to ? formatDate(to) : 'aujourd’hui'}`
      : 'toutes les dates';

  return (
    <PageFrame
      title="Journal d’audit"
      subtitle="Qui a fait quoi, et quand : les actions importantes de la plateforme."
    >
      <QueryState query={audit.query}>
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Actions" value={audit.summary?.total ?? 0} />
            <Stat label="Aujourd’hui" value={audit.summary?.today ?? 0} />
            <Stat
              label="Auteurs"
              className="col-span-2 sm:col-span-1"
              value={audit.summary?.actors ?? 0}
            />
          </div>

          <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <CardTitle>Historique des actions</CardTitle>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!filtered.length}
                  loading={exporting === 'csv'}
                  onClick={() => void exportAll('csv')}
                  icon={<Download className="h-4 w-4" aria-hidden="true" />}
                >
                  CSV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!filtered.length}
                  loading={exporting === 'pdf'}
                  onClick={() => void exportAll('pdf')}
                  icon={<FileText className="h-4 w-4" aria-hidden="true" />}
                >
                  PDF
                </Button>
              </div>
            </div>
            <p className="flex items-start gap-2 rounded-control bg-blue-50 p-3 text-label text-blue-900">
              <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              Ce journal ne peut être ni modifié ni effacé, même par le super administrateur.
            </p>
            <CollapsibleFilters
              activeCount={filters.filter(Boolean).length}
              className="grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
            >
              <Input
                label="Rechercher"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <Select
                label="Auteur"
                value={actorId}
                onChange={(event) => setActorId(event.target.value)}
                options={actors}
                placeholder="Tous les auteurs"
              />
              <Select
                label="Famille"
                value={category}
                onChange={(event) => {
                  setCategory(event.target.value);
                  setAction('');
                }}
                options={(Object.keys(auditCategories) as AuditCategory[]).map((value) => ({
                  value,
                  label: auditCategories[value].label,
                }))}
                placeholder="Toutes les familles"
              />
              <Select
                label="Type d’action"
                value={action}
                onChange={(event) => setAction(event.target.value)}
                options={actions}
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

            {filtered.length ? (
              <div className={cn('flex flex-col gap-4', audit.updating && 'opacity-60')}>
                {byDay(filtered).map(([day, rows]) => (
                  <section key={day} aria-label={dayTitle(day)}>
                    <h3 className="sticky top-0 z-10 border-b border-line bg-white py-2 text-label font-bold text-ink">
                      {dayTitle(day)}
                    </h3>
                    <ol className="divide-y divide-line">
                      {rows.map((row) => (
                        <AuditItem key={row.entry.id} row={row} />
                      ))}
                    </ol>
                  </section>
                ))}
                {audit.more}
              </div>
            ) : (
              <p className="text-muted">
                {filters.some(Boolean)
                  ? 'Aucune action ne correspond aux filtres.'
                  : 'Aucune action enregistrée pour le moment.'}
              </p>
            )}
          </Card>

          <Card className="flex flex-col gap-2">
            <CardTitle>Légende</CardTitle>
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-label text-muted">
              {Object.values(auditCategories).map(({ label, dot }) => (
                <li key={label} className="flex items-center gap-2">
                  <span className={cn('h-2.5 w-2.5 rounded-full', dot)} aria-hidden="true" />
                  {label}
                </li>
              ))}
            </ul>
          </Card>
        </>
      </QueryState>
    </PageFrame>
  );
}
