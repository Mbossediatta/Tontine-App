import {
  eachMonthOfInterval,
  endOfDay,
  endOfMonth,
  isWithinInterval,
  startOfDay,
  startOfMonth,
  subDays,
  subHours,
} from 'date-fns';
import { ServiceError } from '@/lib/errors';
import { fullName, searchable } from '@/lib/format';
import type { AuditView, ReportRow, Round, SecurityEventKind, SecurityEventView } from '@/types';
import type { ReportService } from '../report.service';
import { assertSuperAdmin } from './access';
import { currentUser, db, delay, findUser } from './db';
import { roundCollected, roundExpected } from './metrics';
import { pageOf } from './paging';
import { lateOnRound } from './platform';

function lateAmountFor(round: Round): number {
  if (new Date(round.dueDate) >= new Date()) return 0;
  const group = db.groups.find((item) => item.id === round.groupId);
  return group ? lateOnRound(group, round).reduce((sum, member) => sum + member.amount, 0) : 0;
}

function periodDate(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ServiceError('Période de rapport invalide.');
  return date;
}

function rowsFor(
  rounds: Round[],
  labelFor: (round: Round) => { id: string; label: string; sublabel?: string },
): ReportRow[] {
  const rows = new Map<string, ReportRow>();
  for (const round of rounds) {
    const details = labelFor(round);
    const row = rows.get(details.id) ?? {
      ...details,
      expected: 0,
      collected: 0,
      rate: null,
      lateAmount: 0,
      paidOut: 0,
    };
    row.expected += roundExpected(round);
    row.collected += roundCollected(round);
    row.lateAmount += lateAmountFor(round);
    if (round.status === 'paid_out') row.paidOut += round.potAmount;
    row.rate =
      row.expected > 0 ? Math.min(100, Math.round((row.collected / row.expected) * 100)) : null;
    rows.set(details.id, row);
  }
  return [...rows.values()].sort((a, b) => b.collected - a.collected);
}

export const mockReportService: ReportService = {
  async report(from, to) {
    await delay();
    assertSuperAdmin(currentUser());
    const start = startOfDay(periodDate(from));
    const end = endOfDay(periodDate(to));
    if (start > end) throw new ServiceError('La date de début doit précéder la date de fin.');
    const interval = { start, end };
    // Un tour compte dès que sa collecte (ouverture → date limite) croise la période :
    // le tour en cours apparaît donc avant sa date limite (avant, « du 1er au 4 » d'un
    // mois dont le tour finissait le 10 affichait 0 FCFA collecté).
    const rounds = db.rounds.filter(
      (round) => new Date(round.openDate) <= end && new Date(round.dueDate) >= start,
    );
    const totals = rounds.reduce(
      (sum, round) => {
        const expected = roundExpected(round);
        const collected = roundCollected(round);
        return {
          expected: sum.expected + expected,
          collected: sum.collected + collected,
          rate:
            sum.expected + expected > 0
              ? Math.min(
                  100,
                  Math.round(((sum.collected + collected) / (sum.expected + expected)) * 100),
                )
              : null,
          lateAmount: sum.lateAmount + lateAmountFor(round),
          paidOut: sum.paidOut + (round.status === 'paid_out' ? round.potAmount : 0),
        };
      },
      { expected: 0, collected: 0, rate: null as number | null, lateAmount: 0, paidOut: 0 },
    );
    const monthRange = eachMonthOfInterval({ start: startOfMonth(start), end: startOfMonth(end) });
    const monthly = monthRange.map((month) => {
      const inMonth = rounds.filter((round) =>
        isWithinInterval(new Date(round.dueDate), {
          start: startOfMonth(month),
          end: endOfMonth(month),
        }),
      );
      return {
        month: startOfMonth(month).toISOString(),
        expected: inMonth.reduce((sum, round) => sum + roundExpected(round), 0),
        collected: inMonth.reduce((sum, round) => sum + roundCollected(round), 0),
      };
    });
    const membersInPeriod = db.users.filter(
      (user) =>
        user.globalRole === 'user' &&
        !user.deletedAt &&
        user.createdAt &&
        isWithinInterval(new Date(user.createdAt), interval),
    );
    const members = db.users.filter(
      (user) =>
        user.globalRole === 'user' &&
        !user.deletedAt &&
        user.createdAt &&
        new Date(user.createdAt) <= end,
    ).length;
    const membersByMonth = monthRange.map((month) => {
      const monthEnd = endOfMonth(month);
      const added = membersInPeriod.filter((user) =>
        isWithinInterval(new Date(user.createdAt ?? ''), {
          start: startOfMonth(month),
          end: monthEnd,
        }),
      ).length;
      return {
        month: startOfMonth(month).toISOString(),
        total: db.users.filter(
          (user) =>
            user.globalRole === 'user' &&
            !user.deletedAt &&
            user.createdAt &&
            new Date(user.createdAt) <= monthEnd,
        ).length,
        added,
      };
    });
    return {
      from: start.toISOString(),
      to: end.toISOString(),
      totals: { ...totals, newMembers: membersInPeriod.length, members },
      monthly,
      members: membersByMonth,
      byGroup: rowsFor(rounds, (round) => {
        const group = db.groups.find((item) => item.id === round.groupId);
        return { id: round.groupId, label: group?.name ?? 'Groupe supprimé' };
      }),
      byAdmin: rowsFor(rounds, (round) => {
        const group = db.groups.find((item) => item.id === round.groupId);
        const admin = group ? findUser(group.adminId) : undefined;
        return {
          id: group?.adminId ?? 'unknown',
          label: admin ? fullName(admin) : 'Administrateur inconnu',
        };
      }),
    };
  },

  async auditLog() {
    await delay();
    assertSuperAdmin(currentUser());
    return auditViews();
  },

  async auditPage(filters, cursor, limit) {
    await delay();
    assertSuperAdmin(currentUser());
    const words = searchable(filters.search?.trim() ?? '');
    const matching = auditViews().filter(
      ({ entry, actorName }) =>
        (!words || searchable(`${actorName} ${entry.summary}`).includes(words)) &&
        (!filters.actorId || entry.actorId === filters.actorId) &&
        (!filters.actions || filters.actions.includes(entry.action)) &&
        (!filters.from || entry.at.slice(0, 10) >= filters.from) &&
        (!filters.to || entry.at.slice(0, 10) <= filters.to),
    );
    const page = pageOf(matching, ({ entry }) => ({ at: entry.at, id: entry.id }), cursor, limit);
    if (cursor) return page;
    const today = new Date().toISOString().slice(0, 10);
    return {
      ...page,
      summary: {
        total: matching.length,
        actors: new Set(matching.map(({ entry }) => entry.actorId)).size,
        today: db.auditLog.filter((entry) => entry.at.slice(0, 10) === today).length,
      },
    };
  },

  async auditActors() {
    await delay();
    assertSuperAdmin(currentUser());
    const names = new Map(auditViews().map(({ entry, actorName }) => [entry.actorId, actorName]));
    return [...names]
      .filter(([id]) => id)
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  },

  async securityLog() {
    await delay();
    assertSuperAdmin(currentUser());
    return securityViews();
  },

  async securityPage(filters, cursor, limit) {
    await delay();
    assertSuperAdmin(currentUser());
    const words = searchable(filters.search?.trim() ?? '');
    const matching = securityViews().filter(
      ({ event, userName }) =>
        (!filters.kinds || filters.kinds.includes(event.kind)) &&
        (!filters.severity || event.severity === filters.severity) &&
        (!words ||
          searchable(`${userName ?? ''} ${event.phone ?? ''} ${event.detail}`).includes(words)),
    );
    const page = pageOf(matching, ({ event }) => ({ at: event.at, id: event.id }), cursor, limit);
    return cursor ? page : { ...page, summary: { total: matching.length } };
  },

  async securitySummary() {
    await delay();
    assertSuperAdmin(currentUser());
    const events = db.securityEvents;
    const weekAgo = subDays(new Date(), 7).toISOString();
    const dayAgo = subHours(new Date(), 24).toISOString();
    const lastWeek: Partial<Record<SecurityEventKind, number>> = {};
    for (const event of events) {
      if (event.at >= weekAgo) lastWeek[event.kind] = (lastWeek[event.kind] ?? 0) + 1;
    }
    const count = (keep: (event: (typeof events)[number]) => boolean) => events.filter(keep).length;
    return {
      lastWeek,
      criticalToday: count((event) => event.severity === 'critical' && event.at >= dayAgo),
      all: events.length,
      critical: count((event) => event.severity === 'critical'),
      login: count((event) =>
        ['pin_failed', 'pin_blocked', 'otp_failed', 'admin_login'].includes(event.kind),
      ),
      access: count((event) => event.kind === 'access_denied'),
      input: count((event) => event.kind === 'suspicious_input'),
    };
  },
};

function auditViews(): AuditView[] {
  return [...db.auditLog]
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((entry): AuditView => {
      const actor = findUser(entry.actorId);
      return { entry, actorName: actor ? fullName(actor) : 'Compte supprimé' };
    });
}

function securityViews(): SecurityEventView[] {
  return [...db.securityEvents]
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((event): SecurityEventView => {
      const user = event.userId ? findUser(event.userId) : undefined;
      return { event, userName: user ? fullName(user) : undefined };
    });
}
