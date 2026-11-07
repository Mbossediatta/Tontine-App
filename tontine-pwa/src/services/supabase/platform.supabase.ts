// Notifications (tous), paramètres, rapports et journaux (super admin) sur Supabase.
// Lectures par les tables (RLS) ; paramètres par settings_get / settings_update
// (backend/supabase/migrations/…_parametres.sql).
import {
  eachMonthOfInterval,
  endOfDay,
  endOfMonth,
  isWithinInterval,
  startOfDay,
  startOfMonth,
} from 'date-fns';
import { ServiceError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type {
  AppNotification,
  AuditView,
  NotificationPreferences,
  PlatformSettings,
  ReportRow,
  Round,
  SecurityEventView,
} from '@/types';
import type { NotificationService } from '../notification.service';
import type { ReportService } from '../report.service';
import type { SettingsService } from '../settings.service';
import { groupRows } from './group.supabase';
import {
  currentViewer,
  lateEntries,
  loadContext,
  roundCollected,
  roundExpected,
  type GroupContext,
} from './groupData';
import { requireOnline, rows, rpc, sessionUserId } from './rpc';

// --- Notifications -------------------------------------------------------------------

interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  created_at: string;
}

export function createSupabaseNotificationService(): NotificationService {
  return {
    async list(): Promise<AppNotification[]> {
      const result = await supabase()
        .from('notifications')
        .select('id, user_id, type, title, body, link, read, created_at')
        .eq('user_id', await sessionUserId())
        .order('created_at', { ascending: false })
        .limit(200);
      return rows<NotificationRow>(result).map((row) => ({
        id: row.id,
        userId: row.user_id,
        type: row.type,
        title: row.title,
        body: row.body,
        link: row.link ?? undefined,
        read: row.read,
        createdAt: row.created_at,
      }));
    },

    async markRead(notificationId) {
      rows(await supabase().from('notifications').update({ read: true }).eq('id', notificationId));
    },

    async markAllRead() {
      rows(
        await supabase()
          .from('notifications')
          .update({ read: true })
          .eq('user_id', await sessionUserId())
          .eq('read', false),
      );
    },

    async savePushSubscription(subscription) {
      const keys = subscription.keys ?? {};
      if (!subscription.endpoint || !keys.p256dh || !keys.auth) {
        throw new ServiceError('Abonnement aux notifications invalide.');
      }
      const userId = await sessionUserId();
      // Un même appareil réabonné : l'ancien abonnement est remplacé.
      rows(
        await supabase().from('push_subscriptions').delete().eq('endpoint', subscription.endpoint),
      );
      rows(
        await supabase().from('push_subscriptions').insert({
          user_id: userId,
          endpoint: subscription.endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
        }),
      );
    },

    async getPreferences(): Promise<NotificationPreferences> {
      const [row] = rows<{ notification_prefs: NotificationPreferences }>(
        await supabase()
          .from('profiles')
          .select('notification_prefs')
          .eq('id', await sessionUserId()),
      );
      return row?.notification_prefs ?? { reminders: true, beneficiary: true, payments: true };
    },

    async updatePreferences(preferences) {
      requireOnline();
      const clean: NotificationPreferences = {
        reminders: Boolean(preferences.reminders),
        beneficiary: Boolean(preferences.beneficiary),
        payments: Boolean(preferences.payments),
      };
      rows(
        await supabase()
          .from('profiles')
          .update({ notification_prefs: clean })
          .eq('id', await sessionUserId()),
      );
      return clean;
    },
  };
}

// --- Paramètres ----------------------------------------------------------------------

export function createSupabaseSettingsService(): SettingsService {
  return {
    async get() {
      return rpc<PlatformSettings>('settings_get');
    },
    async update(section, values, newSecret) {
      requireOnline();
      if (section === 'templatesWo') {
        await rpc('settings_update_templates', { p_language: 'wo', p_values: values });
        return;
      }
      await rpc(
        'settings_update',
        { p_section: section, p_values: values, p_new_secret: newSecret?.trim() || null },
        'Enregistrement impossible. Vérifiez la connexion et réessayez.',
      );
    },
  };
}

// --- Rapports et journaux --------------------------------------------------------------

interface PersonRow {
  id: string;
  first_name: string;
  last_name: string;
  global_role: string;
  deleted_at: string | null;
  created_at: string;
}

async function superAdminContext(): Promise<{ ctx: GroupContext; people: PersonRow[] }> {
  const viewer = await currentViewer();
  if (viewer.role !== 'super_admin') {
    throw new ServiceError('Réservé au super administrateur.', 'forbidden');
  }
  const [ctx, people] = await Promise.all([
    loadContext(await groupRows(), viewer),
    supabase()
      .from('profiles')
      .select('id, first_name, last_name, global_role, deleted_at, created_at'),
  ]);
  return { ctx, people: rows<PersonRow>(people) };
}

function nameOf(people: Map<string, PersonRow>, id: string | null | undefined): string | undefined {
  const person = id ? people.get(id) : undefined;
  if (!person) return undefined;
  return person.deleted_at ? 'Compte supprimé' : `${person.first_name} ${person.last_name}`;
}

function periodDate(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ServiceError('Période de rapport invalide.');
  return date;
}

export function createSupabaseReportService(): ReportService {
  return {
    async report(from, to) {
      const start = startOfDay(periodDate(from));
      const end = endOfDay(periodDate(to));
      if (start > end) throw new ServiceError('La date de début doit précéder la date de fin.');
      const { ctx, people } = await superAdminContext();
      const names = new Map(people.map((person) => [person.id, person]));
      const lates = lateEntries(ctx);
      const lateAmountFor = (round: Round) =>
        new Date(round.dueDate) >= new Date()
          ? 0
          : lates
              .filter((late) => late.groupId === round.groupId && late.roundNumber === round.number)
              .reduce((sum, late) => sum + late.amount, 0);
      // Un tour compte dès que sa collecte (ouverture → date limite) croise la période.
      const rounds = ctx.rounds.filter(
        (round) => new Date(round.openDate) <= end && new Date(round.dueDate) >= start,
      );
      const rate = (collected: number, expected: number) =>
        expected > 0 ? Math.min(100, Math.round((collected / expected) * 100)) : null;

      const rowsFor = (labelFor: (round: Round) => { id: string; label: string }): ReportRow[] => {
        const result = new Map<string, ReportRow>();
        for (const round of rounds) {
          const details = labelFor(round);
          const row = result.get(details.id) ?? {
            ...details,
            expected: 0,
            collected: 0,
            rate: null,
            lateAmount: 0,
            paidOut: 0,
          };
          row.expected += roundExpected(ctx, round);
          row.collected += roundCollected(ctx, round);
          row.lateAmount += lateAmountFor(round);
          if (round.status === 'paid_out') row.paidOut += round.potAmount;
          row.rate = rate(row.collected, row.expected);
          result.set(details.id, row);
        }
        return [...result.values()].sort((a, b) => b.collected - a.collected);
      };

      const expected = rounds.reduce((sum, round) => sum + roundExpected(ctx, round), 0);
      const collected = rounds.reduce((sum, round) => sum + roundCollected(ctx, round), 0);
      const members = people.filter(
        (person) => person.global_role === 'user' && !person.deleted_at,
      );
      const months = eachMonthOfInterval({ start: startOfMonth(start), end: startOfMonth(end) });
      const groupById = new Map(ctx.groups.map((group) => [group.id, group]));

      return {
        from: start.toISOString(),
        to: end.toISOString(),
        totals: {
          expected,
          collected,
          rate: rate(collected, expected),
          lateAmount: rounds.reduce((sum, round) => sum + lateAmountFor(round), 0),
          paidOut: rounds.reduce(
            (sum, round) => sum + (round.status === 'paid_out' ? round.potAmount : 0),
            0,
          ),
          newMembers: members.filter((person) =>
            isWithinInterval(new Date(person.created_at), { start, end }),
          ).length,
          members: members.filter((person) => new Date(person.created_at) <= end).length,
        },
        monthly: months.map((month) => {
          const inMonth = rounds.filter((round) =>
            isWithinInterval(new Date(round.dueDate), {
              start: startOfMonth(month),
              end: endOfMonth(month),
            }),
          );
          return {
            month: startOfMonth(month).toISOString(),
            expected: inMonth.reduce((sum, round) => sum + roundExpected(ctx, round), 0),
            collected: inMonth.reduce((sum, round) => sum + roundCollected(ctx, round), 0),
          };
        }),
        members: months.map((month) => ({
          month: startOfMonth(month).toISOString(),
          total: members.filter((person) => new Date(person.created_at) <= endOfMonth(month))
            .length,
          added: members.filter((person) =>
            isWithinInterval(new Date(person.created_at), {
              start: startOfMonth(month),
              end: endOfMonth(month),
            }),
          ).length,
        })),
        byGroup: rowsFor((round) => ({
          id: round.groupId,
          label: groupById.get(round.groupId)?.name ?? 'Groupe supprimé',
        })),
        byAdmin: rowsFor((round) => {
          const adminId = groupById.get(round.groupId)?.adminId ?? 'unknown';
          return { id: adminId, label: nameOf(names, adminId) ?? 'Administrateur inconnu' };
        }),
      };
    },

    async auditLog(): Promise<AuditView[]> {
      const [entries, people] = await Promise.all([
        supabase()
          .from('audit_log')
          .select('id, actor_id, action, summary, group_id, at')
          .order('at', { ascending: false })
          .limit(1000),
        supabase()
          .from('profiles')
          .select('id, first_name, last_name, global_role, deleted_at, created_at'),
      ]);
      const names = new Map(rows<PersonRow>(people).map((person) => [person.id, person]));
      return rows<{
        id: string;
        actor_id: string | null;
        action: AuditView['entry']['action'];
        summary: string;
        group_id: string | null;
        at: string;
      }>(entries).map((entry) => ({
        entry: {
          id: entry.id,
          actorId: entry.actor_id ?? '',
          action: entry.action,
          summary: entry.summary,
          groupId: entry.group_id ?? undefined,
          at: entry.at,
        },
        actorName: nameOf(names, entry.actor_id) ?? 'Compte supprimé',
      }));
    },

    async securityLog(): Promise<SecurityEventView[]> {
      const [events, people] = await Promise.all([
        supabase()
          .from('security_events')
          .select('id, kind, severity, detail, user_id, phone, at')
          .order('at', { ascending: false })
          .limit(1000),
        supabase()
          .from('profiles')
          .select('id, first_name, last_name, global_role, deleted_at, created_at'),
      ]);
      const names = new Map(rows<PersonRow>(people).map((person) => [person.id, person]));
      return rows<{
        id: string;
        kind: SecurityEventView['event']['kind'];
        severity: SecurityEventView['event']['severity'];
        detail: string;
        user_id: string | null;
        phone: string | null;
        at: string;
      }>(events).map((event) => ({
        event: {
          id: event.id,
          kind: event.kind,
          severity: event.severity,
          detail: event.detail,
          userId: event.user_id ?? undefined,
          phone: event.phone ?? undefined,
          at: event.at,
        },
        userName: nameOf(names, event.user_id),
      }));
    },
  };
}
