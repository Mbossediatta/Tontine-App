import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { subDays, subHours } from 'date-fns';
import {
  Ban,
  Bug,
  KeyRound,
  LockKeyhole,
  LogIn,
  MessageSquareWarning,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge, Card, CardTitle } from '@/components/ui';
import { formatDateTime, formatPhone, searchable } from '@/lib/format';
import { reportService } from '@/services';
import type { SecurityEventKind, SecurityEventView, SecuritySeverity } from '@/types';
import { FilterChips, SearchField } from '../components/ListToolbar';
import { Paged } from '../components/Paged';
import { PageFrame, QueryState, Stat } from './PlatformUi';
import { SecurityProtections } from './SecurityProtections';

const KINDS: Record<SecurityEventKind, { label: string; icon: LucideIcon }> = {
  pin_failed: { label: 'PIN incorrect', icon: KeyRound },
  pin_blocked: { label: 'PIN bloqué', icon: LockKeyhole },
  otp_failed: { label: 'Code SMS refusé', icon: MessageSquareWarning },
  access_denied: { label: 'Accès refusé', icon: Ban },
  suspicious_input: { label: 'Saisie suspecte', icon: Bug },
  admin_login: { label: 'Connexion admin', icon: LogIn },
};

const SEVERITY: Record<SecuritySeverity, { label: string; tone: 'danger' | 'warning' | 'info' }> = {
  critical: { label: 'Critique', tone: 'danger' },
  warning: { label: 'Attention', tone: 'warning' },
  info: { label: 'Info', tone: 'info' },
};

type Filter = 'all' | 'critical' | 'login' | 'access' | 'input';

const FILTERS: Record<Filter, (view: SecurityEventView) => boolean> = {
  all: () => true,
  critical: ({ event }) => event.severity === 'critical',
  login: ({ event }) =>
    ['pin_failed', 'pin_blocked', 'otp_failed', 'admin_login'].includes(event.kind),
  access: ({ event }) => event.kind === 'access_denied',
  input: ({ event }) => event.kind === 'suspicious_input',
};

/** Une ligne du journal : type, gravité, détail, compte concerné, date. */
function EventRow({ view }: { view: SecurityEventView }) {
  const { event, userName } = view;
  const { label, icon: Icon } = KINDS[event.kind];
  const who = userName ?? (event.phone ? formatPhone(event.phone) : 'Compte inconnu');
  return (
    <li className="flex gap-3 py-3">
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700"
        aria-hidden="true"
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2">
          <strong className="text-ink">{label}</strong>
          <Badge tone={SEVERITY[event.severity].tone}>{SEVERITY[event.severity].label}</Badge>
        </p>
        <p className="text-label text-ink">{event.detail}</p>
        <p className="text-small text-muted">
          {event.userId ? (
            <Link to={`/admin/membres/${event.userId}`} className="font-bold text-blue-700">
              {who}
            </Link>
          ) : (
            who
          )}{' '}
          · <time dateTime={event.at}>{formatDateTime(event.at)}</time>
        </p>
      </div>
    </li>
  );
}

/**
 * Rubrique « Sécurité » : tentatives de connexion, accès refusés, saisies suspectes
 * (injections) et connexions des administrateurs, avec les protections en place.
 */
export function SecurityPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const log = useQuery({
    queryKey: ['admin', 'security'],
    queryFn: () => reportService.securityLog(),
  });
  const events = useMemo(() => log.data ?? [], [log.data]);

  const weekAgo = subDays(new Date(), 7).toISOString();
  const lastWeek = events.filter(({ event }) => event.at >= weekAgo);
  const countOf = (kind: SecurityEventKind) =>
    lastWeek.filter(({ event }) => event.kind === kind).length;
  const dayAgo = subHours(new Date(), 24).toISOString();
  const criticalToday = events.filter(
    ({ event }) => event.severity === 'critical' && event.at >= dayAgo,
  ).length;

  const words = searchable(search.trim());
  const visible = events.filter(
    (view) =>
      FILTERS[filter](view) &&
      (!words ||
        searchable(
          `${view.userName ?? ''} ${view.event.phone ?? ''} ${view.event.detail}`,
        ).includes(words)),
  );

  return (
    <PageFrame
      title="Sécurité"
      subtitle="Tentatives de connexion, accès refusés et saisies suspectes."
    >
      <QueryState query={log}>
        <>
          {criticalToday > 0 ? (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-card bg-danger-bg p-4 text-danger"
            >
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <p className="font-bold">
                {criticalToday} alerte{criticalToday > 1 ? 's' : ''} critique
                {criticalToday > 1 ? 's' : ''} ces dernières 24 heures.{' '}
                <button
                  type="button"
                  onClick={() => setFilter('critical')}
                  className="underline underline-offset-2"
                >
                  Les voir
                </button>
              </p>
            </div>
          ) : null}

          <section aria-label="Les 7 derniers jours" className="flex flex-col gap-2">
            <h2 className="text-label font-bold text-muted">Les 7 derniers jours</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Stat label="PIN incorrects" value={countOf('pin_failed')} />
              <Stat label="PIN bloqués" value={countOf('pin_blocked')} />
              <Stat label="Codes SMS refusés" value={countOf('otp_failed')} />
              <Stat label="Accès refusés" value={countOf('access_denied')} />
              <Stat
                label="Saisies suspectes"
                className="col-span-2 lg:col-span-1"
                value={countOf('suspicious_input')}
              />
            </div>
          </section>

          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <Card className="flex min-w-0 flex-col gap-3">
              <CardTitle>Journal de sécurité</CardTitle>
              <SearchField
                value={search}
                onChange={setSearch}
                placeholder="Rechercher un nom, un numéro…"
              />
              <FilterChips
                label="Filtrer les événements"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: 'Tous', count: events.length },
                  {
                    value: 'critical',
                    label: 'Critiques',
                    count: events.filter(FILTERS.critical).length,
                  },
                  {
                    value: 'login',
                    label: 'Connexion',
                    count: events.filter(FILTERS.login).length,
                  },
                  {
                    value: 'access',
                    label: 'Accès refusés',
                    count: events.filter(FILTERS.access).length,
                  },
                  {
                    value: 'input',
                    label: 'Saisies suspectes',
                    count: events.filter(FILTERS.input).length,
                  },
                ]}
              />
              {visible.length ? (
                <Paged items={visible} pageSize={30} resetKey={`${filter}|${search}`}>
                  {(page) => (
                    <ul className="divide-y divide-line">
                      {page.map((view) => (
                        <EventRow key={view.event.id} view={view} />
                      ))}
                    </ul>
                  )}
                </Paged>
              ) : (
                <p className="text-muted">Aucun événement ne correspond à ces filtres.</p>
              )}
            </Card>
            <SecurityProtections />
          </div>
        </>
      </QueryState>
    </PageFrame>
  );
}
