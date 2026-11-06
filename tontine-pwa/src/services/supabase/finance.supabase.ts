// Finances, litiges et annonces (super admin) sur Supabase : lectures par les tables (le
// super admin voit tout), actions par les fonctions de …_finances_litiges_annonces.sql et
// l'Edge Function announcement-send.
import { isSameMonth, subDays } from 'date-fns';
import { ServiceError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type {
  AdminCompensation,
  Dispute,
  DisputeView,
  PayoutRow,
  PayoutStage,
  PlatformEarning,
  PublicUser,
  Round,
  SmsKind,
  SmsStats,
} from '@/types';
import type { CommunicationService } from '../communication.service';
import type { DisputeService } from '../dispute.service';
import type { FinanceService } from '../finance.service';
import { groupRows } from './group.supabase';
import {
  activeMemberships,
  currentViewer,
  loadContext,
  person,
  roundCollected,
  roundExpected,
  transactionRows,
  type GroupContext,
} from './groupData';
import { invoke, requireOnline, rows, rpc } from './rpc';

interface ProfileRow {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  deleted_at: string | null;
}

/** Contexte complet du super admin : groupes, tours, paiements et comptes. */
async function superAdminData() {
  const viewer = await currentViewer();
  if (viewer.role !== 'super_admin') {
    throw new ServiceError('Réservé au super administrateur.', 'forbidden');
  }
  const [ctx, profiles] = await Promise.all([
    loadContext(await groupRows(), viewer),
    supabase().from('profiles').select('id, first_name, last_name, phone, deleted_at'),
  ]);
  const people = new Map(rows<ProfileRow>(profiles).map((row) => [row.id, row]));
  const nameOf = (id: string | null | undefined, fallback: string) => {
    const row = id ? people.get(id) : undefined;
    if (!row) return fallback;
    return row.deleted_at ? 'Compte supprimé' : `${row.first_name} ${row.last_name}`;
  };
  return { ctx, people, nameOf };
}

/** Étape d'un versement : un blocage l'emporte sur tout ce qui n'est pas encore versé. */
function stageOf(round: Round): PayoutStage {
  if (round.status === 'paid_out') return 'paid';
  if (round.payoutBlockedAt) return 'blocked';
  if (round.status === 'ready_for_payout') return 'ready';
  return round.status === 'open' ? 'collecting' : 'upcoming';
}

/** Ordre d'affichage : ce qui demande de l'attention d'abord. */
const STAGE_ORDER: Record<PayoutStage, number> = {
  blocked: 0,
  ready: 1,
  collecting: 2,
  upcoming: 3,
  paid: 4,
};

/** Bénéficiaire affiché pour la période réservée au super admin. */
const PLATFORM: PublicUser = { id: '', firstName: 'Calebasse', lastName: 'de l’Espoir' };

function payoutRows(ctx: GroupContext, nameOf: (id: string | undefined, f: string) => string) {
  const groups = new Map(ctx.groups.map((group) => [group.id, group]));
  const result: PayoutRow[] = ctx.rounds.flatMap((round) => {
    const group = groups.get(round.groupId);
    if (!group || group.archivedAt) return [];
    const beneficiaries = activeMemberships(ctx, group.id)
      .filter((item) => round.beneficiaryMembershipIds?.includes(item.id))
      .map((item) => person(ctx, item.userId, true));
    const unique = [...new Map(beneficiaries.map((item) => [item.id, item])).values()];
    return [
      {
        round,
        groupId: group.id,
        groupName: group.name,
        adminName: nameOf(group.adminId, '—'),
        beneficiary: unique[0] ?? PLATFORM,
        beneficiaries: unique,
        stage: stageOf(round),
        collected: roundCollected(ctx, round),
        expected: roundExpected(ctx, round),
        validatedByName: round.payoutValidatedBy
          ? nameOf(round.payoutValidatedBy, 'Compte supprimé')
          : undefined,
      },
    ];
  });
  return result.sort((a, b) => {
    const byStage = STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage];
    if (byStage !== 0) return byStage;
    // Effectués : le plus récent d'abord ; les autres : le plus proche d'abord.
    return a.stage === 'paid'
      ? (b.round.paidOutAt ?? '').localeCompare(a.round.paidOutAt ?? '')
      : a.round.dueDate.localeCompare(b.round.dueDate);
  });
}

export function createSupabaseFinanceService(): FinanceService {
  return {
    async reconciliation(month) {
      const target = new Date(month);
      const { ctx, people } = await superAdminData();
      const ledgerRows = rows<{ ref: string; phone: string | null; amount: number; at: string }>(
        await supabase().from('provider_ledger').select('ref, phone, amount, at'),
      );
      const inMonth = (iso?: string) => !!iso && isSameMonth(new Date(iso), target);
      const paid = transactionRows(ctx).filter(
        (row) => row.payment.status === 'paid' && inMonth(row.payment.paidAt),
      );
      const online = paid.filter((row) => row.payment.method !== 'cash');
      const cash = paid.filter((row) => row.payment.method === 'cash');
      const ledger = ledgerRows.filter((entry) => inMonth(entry.at));
      const ledgerRefs = new Set(ledger.map((entry) => entry.ref));
      // Toutes périodes confondues : un paiement enregistré n'est pas un « orphelin ».
      const appRefs = new Set(
        ctx.payments.filter((p) => p.status === 'paid' && p.providerRef).map((p) => p.providerRef),
      );
      const byPhone = new Map(
        [...people.values()].filter((row) => row.phone).map((row) => [row.phone, row]),
      );
      const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
      return {
        month: target.toISOString(),
        expected: sum(
          ctx.rounds
            .filter((round) => isSameMonth(new Date(round.dueDate), target))
            .map((round) => roundExpected(ctx, round)),
        ),
        recordedOnline: sum(online.map((row) => row.payment.amount)),
        recordedCash: sum(cash.map((row) => row.payment.amount)),
        provider: sum(ledger.map((entry) => entry.amount)),
        providerOnly: ledger
          .filter((entry) => !appRefs.has(entry.ref))
          .map((entry) => {
            // PayTech donne le numéro avec l'indicatif (221…) : on compare les 9 chiffres.
            const local = (entry.phone ?? '').replace(/\D/g, '').slice(-9);
            const owner = byPhone.get(local);
            return {
              ref: entry.ref,
              phone: local,
              amount: entry.amount,
              at: entry.at,
              userName: owner ? `${owner.first_name} ${owner.last_name}` : undefined,
            };
          }),
        appOnly: online.filter((row) => !ledgerRefs.has(row.payment.providerRef ?? '')),
        matched: online.filter((row) => ledgerRefs.has(row.payment.providerRef ?? '')).length,
      };
    },

    async payouts() {
      const { ctx, nameOf } = await superAdminData();
      return payoutRows(ctx, nameOf);
    },

    async earnings() {
      const { ctx, nameOf } = await superAdminData();
      const [earningRows, compensationRows] = await Promise.all([
        supabase()
          .from('platform_earnings')
          .select('id, group_id, kind, amount, at, payment_id, round_id, user_id')
          .order('at', { ascending: false }),
        supabase()
          .from('admin_compensations')
          .select('id, group_id, admin_id, amount, note, at, paid_by')
          .order('at', { ascending: false }),
      ]);
      const groupNames = new Map(ctx.groups.map((group) => [group.id, group.name]));
      const earnings = rows<{
        id: string;
        group_id: string;
        kind: PlatformEarning['kind'];
        amount: number;
        at: string;
        payment_id: string | null;
        round_id: string | null;
        user_id: string | null;
      }>(earningRows).map((row) => ({
        id: row.id,
        groupId: row.group_id,
        kind: row.kind,
        amount: row.amount,
        at: row.at,
        paymentId: row.payment_id ?? undefined,
        roundId: row.round_id ?? undefined,
        userId: row.user_id ?? undefined,
        groupName: groupNames.get(row.group_id) ?? 'Groupe supprimé',
        memberName: row.user_id ? nameOf(row.user_id, 'Compte supprimé') : undefined,
      }));
      const compensations = rows<{
        id: string;
        group_id: string;
        admin_id: string;
        amount: number;
        note: string;
        at: string;
        paid_by: string;
      }>(compensationRows).map(
        (row): AdminCompensation & { groupName: string; adminName: string } => ({
          id: row.id,
          groupId: row.group_id,
          adminId: row.admin_id,
          amount: row.amount,
          note: row.note,
          at: row.at,
          paidBy: row.paid_by,
          groupName: groupNames.get(row.group_id) ?? 'Groupe supprimé',
          adminName: nameOf(row.admin_id, 'Admin supprimé'),
        }),
      );
      const earnedTotal = earnings.reduce((total, row) => total + row.amount, 0);
      const compensatedTotal = compensations.reduce((total, row) => total + row.amount, 0);
      // Disponible : par groupe, revenus moins rémunérations (jamais négatif).
      const balances = new Map<string, number>();
      for (const row of earnings)
        balances.set(row.groupId, (balances.get(row.groupId) ?? 0) + row.amount);
      for (const row of compensations) {
        balances.set(row.groupId, (balances.get(row.groupId) ?? 0) - row.amount);
      }
      return {
        earnings,
        compensations,
        earnedTotal,
        compensatedTotal,
        available: [...balances.values()].reduce((total, value) => total + Math.max(0, value), 0),
      };
    },

    async compensateAdmin(groupId, amount, note) {
      requireOnline();
      await rpc('admin_compensate', { p_group: groupId, p_amount: amount, p_note: note });
    },

    async blockPayout(roundId, reason) {
      requireOnline();
      await rpc('payout_block', { p_round: roundId, p_reason: reason });
    },

    async unblockPayout(roundId) {
      requireOnline();
      await rpc('payout_unblock', { p_round: roundId });
    },
  };
}

interface DisputeRow {
  id: string;
  user_id: string;
  group_id: string;
  round_id: string | null;
  payment_id: string | null;
  provider_ref: string | null;
  method: Dispute['method'] | null;
  kind: Dispute['kind'];
  description: string;
  amount: number;
  status: Dispute['status'];
  refund_amount: number | null;
  refund_validated_at: string | null;
  refund_validated_by: string | null;
  created_at: string;
  dispute_events: Array<{ actor_id: string | null; text: string; at: string }>;
}

export function createSupabaseDisputeService(): DisputeService {
  return {
    async open(input) {
      requireOnline();
      await rpc('dispute_open', {
        p_group: input.groupId,
        p_round: input.roundId ?? null,
        p_kind: input.kind,
        p_amount: input.amount,
        p_method: input.method ?? null,
        p_provider_ref: input.providerRef ?? null,
        p_description: input.description,
      });
    },

    async listMine() {
      // Les règles d'accès ne renvoient que mes réclamations.
      const disputeRows = rows<DisputeRow>(
        await supabase()
          .from('disputes')
          .select(
            'id, user_id, group_id, round_id, payment_id, provider_ref, method, kind, description, amount, status, refund_amount, refund_validated_at, refund_validated_by, created_at, dispute_events (actor_id, text, at)',
          )
          .order('created_at', { ascending: false }),
      );
      const groupIds = [...new Set(disputeRows.map((row) => row.group_id))];
      const roundIds = [...new Set(disputeRows.flatMap((row) => row.round_id ?? []))];
      const [groupsResult, roundsResult] = await Promise.all([
        groupIds.length
          ? supabase().from('groups').select('id, name').in('id', groupIds)
          : Promise.resolve({ data: [], error: null }),
        roundIds.length
          ? supabase().from('rounds').select('id, number').in('id', roundIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      const groupNames = new Map(
        rows<{ id: string; name: string }>(groupsResult).map((group) => [group.id, group.name]),
      );
      const roundNumbers = new Map(
        rows<{ id: string; number: number }>(roundsResult).map((round) => [round.id, round.number]),
      );
      return disputeRows.map((row) => {
        const history = [...row.dispute_events]
          .sort((a, b) => a.at.localeCompare(b.at))
          .map((event) => ({ at: event.at, actorId: event.actor_id ?? '', text: event.text }));
        return {
          dispute: {
            id: row.id,
            userId: row.user_id,
            groupId: row.group_id,
            roundId: row.round_id ?? undefined,
            paymentId: row.payment_id ?? undefined,
            providerRef: row.provider_ref ?? undefined,
            method: row.method ?? undefined,
            kind: row.kind,
            description: row.description,
            amount: row.amount,
            status: row.status,
            createdAt: row.created_at,
            history,
          },
          groupName: groupNames.get(row.group_id) ?? '—',
          roundNumber: row.round_id ? roundNumbers.get(row.round_id) : undefined,
          history,
        };
      });
    },

    async list(): Promise<DisputeView[]> {
      const [{ ctx, nameOf }, result] = await Promise.all([
        superAdminData(),
        supabase()
          .from('disputes')
          .select(
            'id, user_id, group_id, round_id, payment_id, provider_ref, method, kind, description, amount, status, refund_amount, refund_validated_at, refund_validated_by, created_at, dispute_events (actor_id, text, at)',
          )
          .order('created_at', { ascending: false }),
      ]);
      const groupNames = new Map(ctx.groups.map((group) => [group.id, group.name]));
      return rows<DisputeRow>(result).map((row) => {
        const history = [...row.dispute_events]
          .sort((a, b) => a.at.localeCompare(b.at))
          .map((event) => ({ at: event.at, actorId: event.actor_id ?? '', text: event.text }));
        return {
          dispute: {
            id: row.id,
            userId: row.user_id,
            groupId: row.group_id,
            roundId: row.round_id ?? undefined,
            paymentId: row.payment_id ?? undefined,
            providerRef: row.provider_ref ?? undefined,
            method: row.method ?? undefined,
            kind: row.kind,
            description: row.description,
            amount: row.amount,
            status: row.status,
            refund:
              row.refund_amount && row.refund_validated_at && row.refund_validated_by
                ? {
                    amount: row.refund_amount,
                    validatedAt: row.refund_validated_at,
                    validatedBy: row.refund_validated_by,
                  }
                : undefined,
            createdAt: row.created_at,
            history,
          },
          user: person(ctx, row.user_id, true),
          groupName: groupNames.get(row.group_id) ?? '—',
          payment: ctx.payments.find((payment) => payment.id === row.payment_id),
          history: history.map((event) => ({
            ...event,
            actorName: event.actorId ? nameOf(event.actorId, '—') : 'Système',
          })),
        };
      });
    },

    async take(disputeId) {
      requireOnline();
      await rpc('dispute_take', { p_dispute: disputeId });
    },

    async recordPayment(disputeId) {
      requireOnline();
      await rpc('dispute_record_payment', { p_dispute: disputeId });
    },

    async refund(disputeId, amount, note) {
      requireOnline();
      await rpc('dispute_refund', { p_dispute: disputeId, p_amount: amount, p_note: note });
    },

    async reject(disputeId, note) {
      requireOnline();
      await rpc('dispute_reject', { p_dispute: disputeId, p_note: note });
    },
  };
}

const SMS_KINDS: SmsKind[] = ['otp', 'reminder', 'announcement', 'payment', 'payout'];

export function createSupabaseCommunicationService(): CommunicationService {
  return {
    async announce(target, title, message) {
      const reply = await invoke<{ count: number }>(
        'announcement-send',
        { target, title, message },
        'Annonce non envoyée. Vérifiez la connexion et réessayez.',
      );
      return reply.count;
    },

    async smsStats(days): Promise<SmsStats> {
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        throw new ServiceError('La période doit être comprise entre 1 et 365 jours.');
      }
      const [smsRows, profiles] = await Promise.all([
        supabase()
          .from('sms_log')
          .select('id, phone, kind, cost, at')
          .gte('at', subDays(new Date(), days).toISOString())
          .order('at', { ascending: false }),
        supabase().from('profiles').select('id, first_name, last_name, phone, deleted_at'),
      ]);
      const records = rows<{ id: string; phone: string; kind: SmsKind; cost: number; at: string }>(
        smsRows,
      );
      const firstNames = new Map(
        rows<ProfileRow>(profiles).map((row) => [row.phone, row.first_name]),
      );
      return {
        count: records.length,
        cost: records.reduce((total, sms) => total + sms.cost, 0),
        byKind: SMS_KINDS.map((kind) => {
          const entries = records.filter((sms) => sms.kind === kind);
          return { kind, count: entries.length, cost: entries.reduce((t, s) => t + s.cost, 0) };
        }),
        recent: records
          .slice(0, 30)
          .map((sms) => ({ ...sms, name: firstNames.get(sms.phone) ?? undefined })),
      };
    },
  };
}
