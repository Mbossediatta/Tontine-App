import {
  eachMonthOfInterval,
  endOfDay,
  endOfMonth,
  isWithinInterval,
  startOfDay,
  startOfMonth,
} from 'date-fns';
import { ServiceError } from '@/lib/errors';
import { fullName } from '@/lib/format';
import type { AuditView, ReportRow, Round } from '@/types';
import type { ReportService } from '../report.service';
import { assertSuperAdmin } from './access';
import { currentUser, db, delay, findUser } from './db';
import { roundCollected, roundExpected } from './metrics';
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
    return [...db.auditLog]
      .sort((a, b) => b.at.localeCompare(a.at))
      .map((entry): AuditView => {
        const actor = findUser(entry.actorId);
        return { entry, actorName: actor ? fullName(actor) : 'Compte supprimé' };
      });
  },
};
