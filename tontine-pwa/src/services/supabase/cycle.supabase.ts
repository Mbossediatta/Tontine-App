// Tours, paiements et échanges de tour sur Supabase.
// Ordre des bénéficiaires, tours, statuts, paiements en espèces, versement (…_cycle.sql),
// paiement en ligne PayTech, relances (…_relances.sql) et échanges de tour (…_echanges.sql).
import { ServiceError } from '@/lib/errors';
import { contributionPerTurn, roundDeadline } from '@/lib/tontine';
import { supabase } from '@/lib/supabase';
import type {
  InitiatePaymentResult,
  MyTransaction,
  PaymentReceipt,
  PaymentHistoryItem,
  PublicUser,
  Round,
  RoundPaymentRow,
  RoundView,
  SwapStatus,
  SwapView,
} from '@/types';
import type { PaymentService } from '../payment.service';
import type { RoundService } from '../round.service';
import type { SwapService } from '../swap.service';
import { groupRows } from './group.supabase';
import {
  activeMemberships,
  buildMemberViews,
  canManage,
  cycleRounds,
  currentViewer,
  loadContext,
  memberStatus,
  paidCountOf,
  penaltyFor,
  person,
  type GroupContext,
} from './groupData';
import { invoke, requireOnline, rows, rpc, sessionUserId } from './rpc';
import type { SimulatedCheckout } from '../mock/gateway';

/** Bénéficiaire affiché pour la période réservée au super admin. */
const PLATFORM: PublicUser = { id: '', firstName: 'Calebasse', lastName: 'de l’Espoir' };
/** Bénéficiaire d'un tour qui n'est pas le mien : son nom reste confidentiel. */
const ANOTHER_MEMBER: PublicUser = { id: '', firstName: 'Un autre', lastName: 'membre' };

async function groupContext(groupId: string): Promise<GroupContext> {
  const ctx = await loadContext(await groupRows((query) => query.eq('id', groupId)));
  if (ctx.groups.length === 0) {
    throw new ServiceError('Vous ne faites pas partie de ce groupe.', 'forbidden');
  }
  return ctx;
}

async function groupIdOfRound(roundId: string): Promise<string> {
  const [round] = rows<{ group_id: string }>(
    await supabase().from('rounds').select('group_id').eq('id', roundId),
  );
  if (!round) throw new ServiceError('Ce tour n’existe pas.', 'not_found');
  return round.group_id;
}

/** Vue d'un tour : bénéficiaires et leur part (réelle si versée, prévue sinon). */
function roundView(ctx: GroupContext, round: Round, manager: boolean): RoundView {
  const recipients =
    round.recipientType === 'platform'
      ? []
      : activeMemberships(ctx, round.groupId).filter((member) =>
          round.beneficiaryMembershipIds?.includes(member.id),
        );
  // Un membre ne voit que ses parts : la cagnotte se partage entre tous les bénéficiaires.
  const recipientCount = ctx.beneficiaryCounts.get(round.id) ?? recipients.length;
  const shareValue = Math.floor(round.potAmount / Math.max(1, recipientCount));
  let remainder = round.potAmount - shareValue * recipientCount;
  const shares = new Map<string, { user: PublicUser; shareCount: number; amount: number }>();
  for (const member of recipients) {
    const amount = shareValue + (remainder > 0 ? 1 : 0);
    remainder = Math.max(0, remainder - 1);
    const existing = shares.get(member.userId);
    if (existing) {
      existing.shareCount += 1;
      existing.amount += amount;
    } else {
      shares.set(member.userId, {
        user: person(ctx, member.userId, manager),
        shareCount: 1,
        amount,
      });
    }
  }
  if (round.status === 'paid_out') {
    for (const [userId, share] of shares) {
      share.amount = round.beneficiaryAmounts?.[userId] ?? share.amount;
    }
  }
  const beneficiaryShares = [...shares.values()];
  const beneficiaries = beneficiaryShares.map((share) => share.user);
  return {
    round: round.recipientType === 'platform' && !manager ? { ...round, potAmount: 0 } : round,
    beneficiary:
      beneficiaries[0] ?? (round.recipientType === 'platform' ? PLATFORM : ANOTHER_MEMBER),
    beneficiaries,
    beneficiaryShares,
    paidCount: paidCountOf(ctx, round),
    deadline: roundDeadline(
      round.dueDate,
      ctx.graceDays,
      ctx.groups.find((group) => group.id === round.groupId)?.paymentDueTime,
    ).toISOString(),
  };
}

/** Tours versés où cette personne a reçu une part. */
function receivedRounds(ctx: GroupContext, userId: string): Round[] {
  return ctx.rounds.filter(
    (round) =>
      round.status === 'paid_out' &&
      round.recipientType !== 'platform' &&
      (round.beneficiaryAmounts?.[userId] ?? 0) > 0,
  );
}

export function createSupabaseRoundService(): RoundService {
  return {
    async list(groupId) {
      const ctx = await groupContext(groupId);
      const group = ctx.groups[0];
      if (!group) return [];
      const manager = canManage(ctx, group);
      return cycleRounds(ctx, group).map((round) => roundView(ctx, round, manager));
    },

    async drawOrder(groupId) {
      requireOnline();
      await rpc('order_draw', { p_group: groupId });
      const ctx = await groupContext(groupId);
      const group = ctx.groups[0];
      return group
        ? buildMemberViews(ctx, group).filter((item) => item.membership.status === 'active')
        : [];
    },

    async setManualOrder(groupId, membershipIds) {
      requireOnline();
      await rpc('order_set', { p_group: groupId, p_memberships: membershipIds });
    },

    async payout(roundId) {
      requireOnline();
      return rpc<'paid' | 'pending_approval'>('round_payout', { p_round: roundId });
    },

    async sendPayoutAuto(roundId, userId) {
      requireOnline();
      await invoke('payout-send', { roundId, userId });
    },

    async markPayoutSent(roundId, userId, method, ref) {
      requireOnline();
      await rpc('payout_mark_sent', {
        p_round: roundId,
        p_user: userId,
        p_method: method,
        p_ref: ref,
      });
    },

    async confirmPayoutReceived(roundId) {
      requireOnline();
      await rpc('payout_confirm_received', { p_round: roundId });
    },
  };
}

interface DebtRow {
  id: string;
  group_id: string;
  round_id: string;
  user_id: string;
  amount: number;
  penalty_amount: number;
  status: 'open' | 'settled';
  settled_via: 'cash' | 'withheld' | null;
  created_at: string;
  settled_at: string | null;
}

export function createSupabasePaymentService(): PaymentService {
  return {
    async listForRound(roundId): Promise<RoundPaymentRow[]> {
      const ctx = await groupContext(await groupIdOfRound(roundId));
      const group = ctx.groups[0];
      const round = ctx.rounds.find((item) => item.id === roundId);
      if (!group || !round) throw new ServiceError('Ce tour n’existe pas.', 'not_found');
      if (!canManage(ctx, group)) {
        throw new ServiceError(
          'Seuls les administrateurs du groupe peuvent faire cela.',
          'forbidden',
        );
      }
      const shareCounts = new Map<string, number>();
      for (const member of activeMemberships(ctx, group.id)) {
        shareCounts.set(member.userId, (shareCounts.get(member.userId) ?? 0) + 1);
      }
      return [...shareCounts].map(([userId, shareCount]) => {
        const payments = ctx.payments.filter(
          (payment) => payment.roundId === roundId && payment.userId === userId,
        );
        const paid = payments.filter((payment) => payment.status === 'paid');
        const penalty = penaltyFor(ctx, roundId, userId);
        return {
          user: person(ctx, userId, true),
          status: memberStatus(ctx, round, userId),
          // Le dernier versement réussi, sinon le dernier essai.
          payment: paid.at(-1) ?? payments.at(-1),
          shareCount,
          penalty,
          paidAmount: paid.reduce(
            (sum, payment) =>
              sum +
              (payment.contributionAmount ?? payment.amount) +
              (payment.latePenaltyAmount ?? 0),
            0,
          ),
          totalAmount: contributionPerTurn(group, round) * shareCount + penalty,
        };
      });
    },

    async listMine(groupId) {
      const [ctx, me] = await Promise.all([groupContext(groupId), sessionUserId()]);
      const rounds = new Map(ctx.rounds.map((round) => [round.id, round]));
      const payments: PaymentHistoryItem[] = ctx.payments
        .filter((payment) => payment.userId === me && payment.status !== 'late')
        .map((payment) => ({
          payment,
          roundNumber: rounds.get(payment.roundId)?.number ?? 0,
          cycle: rounds.get(payment.roundId)?.cycle ?? 1,
        }))
        .sort((a, b) => (b.payment.paidAt ?? '').localeCompare(a.payment.paidAt ?? ''));
      return { payments, received: receivedRounds(ctx, me) };
    },

    async myTransactions() {
      const viewer = await currentViewer();
      const mine = rows<{ group_id: string }>(
        await supabase()
          .from('memberships')
          .select('group_id')
          .eq('user_id', viewer.id)
          .eq('status', 'active'),
      );
      const ids = [...new Set(mine.map((item) => item.group_id))];
      if (ids.length === 0) return [];
      const ctx = await loadContext(await groupRows((query) => query.in('id', ids)), viewer);
      const rounds = new Map(ctx.rounds.map((round) => [round.id, round]));
      const names = new Map(ctx.groups.map((group) => [group.id, group.name]));
      // Cotisations : les lignes « en retard » ne sont pas des paiements, on les écarte.
      const contributions: MyTransaction[] = ctx.payments
        .filter((payment) => payment.userId === viewer.id && payment.status !== 'late')
        .flatMap((payment) => {
          const round = rounds.get(payment.roundId);
          const date = payment.paidAt ?? payment.createdAt;
          if (!round || !date) return [];
          return [
            {
              kind: 'contribution' as const,
              id: payment.id,
              date,
              groupId: round.groupId,
              groupName: names.get(round.groupId) ?? '—',
              roundNumber: round.number,
              cycle: round.cycle,
              payment,
            },
          ];
        });
      const payouts: MyTransaction[] = receivedRounds(ctx, viewer.id).flatMap((round) =>
        round.paidOutAt
          ? [
              {
                kind: 'payout' as const,
                id: `payout-${round.id}`,
                date: round.paidOutAt,
                groupId: round.groupId,
                groupName: names.get(round.groupId) ?? '—',
                roundNumber: round.number,
                amount: round.beneficiaryAmounts?.[viewer.id] ?? 0,
              },
            ]
          : [],
      );
      return [...contributions, ...payouts].sort((a, b) => b.date.localeCompare(a.date));
    },

    async initiatePayment({ roundId, method, periods }) {
      return invoke<InitiatePaymentResult>(
        'payments-initiate',
        { roundId, method, periods },
        'Le service de paiement est indisponible pour le moment. Réessayez dans quelques minutes.',
      );
    },

    async getReceipt(paymentId) {
      return rpc<PaymentReceipt>('payment_receipt', { p_payment: paymentId });
    },

    async recordCash(roundId, userId, periods) {
      requireOnline();
      await rpc('payment_record_cash', {
        p_round: roundId,
        p_user: userId,
        p_periods: periods ?? null,
      });
    },

    async listDebts(groupId) {
      const ctx = await groupContext(groupId);
      const group = ctx.groups[0];
      if (!group) return [];
      // Les règles d'accès ne renvoient que mes dettes, ou toutes pour un admin du groupe.
      const debtRows = rows<DebtRow>(
        await supabase()
          .from('debts')
          .select(
            'id, group_id, round_id, user_id, amount, penalty_amount, status, settled_via, created_at, settled_at',
          )
          .eq('group_id', groupId)
          .order('created_at', { ascending: false }),
      );
      const manager = canManage(ctx, group);
      return debtRows.map((row) => ({
        debt: {
          id: row.id,
          groupId: row.group_id,
          roundId: row.round_id,
          userId: row.user_id,
          amount: row.amount,
          penaltyAmount: row.penalty_amount,
          status: row.status,
          settledVia: row.settled_via ?? undefined,
          createdAt: row.created_at,
          settledAt: row.settled_at ?? undefined,
        },
        user: person(ctx, row.user_id, manager),
        roundNumber: ctx.rounds.find((round) => round.id === row.round_id)?.number ?? 0,
      }));
    },

    async payDebt(debtId, method) {
      requireOnline();
      return invoke<InitiatePaymentResult>(
        'payments-initiate',
        { debtId, method },
        'Le service de paiement est indisponible pour le moment. Réessayez dans quelques minutes.',
      );
    },

    async recordDebtPayment(debtId) {
      requireOnline();
      await rpc('debt_record_payment', { p_debt: debtId });
    },

    // Notification (et push) « Retard » dans la langue du membre ; une par membre et par jour.
    async remindLate(roundId) {
      requireOnline();
      return rpc<number>('reminder_send', { p_round: roundId });
    },

    async remindMember(roundId, userId) {
      requireOnline();
      await rpc('reminder_send', { p_round: roundId, p_user: userId });
    },
  };
}

/**
 * Page de paiement simulée en mode réel : le serveur ne l'accepte qu'en local et sans clés
 * PayTech (payments-simulate) ; la confirmation suit le chemin d'une vraie notification.
 */
export const supabaseSimulatedCheckout = {
  async get(paymentId: string): Promise<SimulatedCheckout> {
    const receipt = await rpc<PaymentReceipt>('payment_receipt', { p_payment: paymentId });
    return {
      paymentId,
      amount: receipt.payment.amount + (receipt.payment.serviceFeeAmount ?? 0),
      method: receipt.payment.method,
      groupName: receipt.groupName,
    };
  },
  async complete(paymentId: string, success: boolean): Promise<void> {
    await invoke('payments-simulate', { paymentId, success });
  },
};

interface SwapRow {
  id: string;
  group_id: string;
  cycle: number;
  requester_id: string;
  partner_id: string;
  requester_round_id: string;
  partner_round_id: string;
  requester_membership_id: string;
  partner_membership_id: string;
  status: SwapStatus;
  created_at: string;
  decided_at: string | null;
}

// Demande, accord du partenaire puis validation d'un admin (…_echanges.sql).
export function createSupabaseSwapService(): SwapService {
  return {
    async list(groupId) {
      const ctx = await groupContext(groupId);
      const group = ctx.groups[0];
      if (!group) return [];
      // Les règles d'accès ne renvoient que mes demandes, ou toutes pour un admin.
      const swapRows = rows<SwapRow>(
        await supabase()
          .from('swap_requests')
          .select('*')
          .eq('group_id', groupId)
          .eq('cycle', group.currentCycle)
          .order('created_at', { ascending: false }),
      );
      const manager = canManage(ctx, group);
      return swapRows.flatMap((row): SwapView[] => {
        const requesterRound = ctx.rounds.find((round) => round.id === row.requester_round_id);
        const partnerRound = ctx.rounds.find((round) => round.id === row.partner_round_id);
        if (!requesterRound || !partnerRound) return [];
        return [
          {
            request: {
              id: row.id,
              groupId: row.group_id,
              cycle: row.cycle,
              requesterId: row.requester_id,
              partnerId: row.partner_id,
              requesterRoundId: row.requester_round_id,
              partnerRoundId: row.partner_round_id,
              requesterMembershipId: row.requester_membership_id,
              partnerMembershipId: row.partner_membership_id,
              status: row.status,
              createdAt: row.created_at,
              decidedAt: row.decided_at ?? undefined,
            },
            requester: person(ctx, row.requester_id, manager),
            partner: person(ctx, row.partner_id, manager),
            requesterRound,
            partnerRound,
          },
        ];
      });
    },
    async request(myRoundId, partnerRoundId, partnerId) {
      requireOnline();
      await rpc('swap_request', {
        p_my_round: myRoundId,
        p_partner_round: partnerRoundId,
        p_partner: partnerId ?? null,
      });
    },
    async respond(swapId, accept) {
      requireOnline();
      await rpc('swap_respond', { p_swap: swapId, p_accept: accept });
    },
    async decide(swapId, approve) {
      requireOnline();
      await rpc('swap_decide', { p_swap: swapId, p_approve: approve });
    },
    async cancel(swapId) {
      requireOnline();
      await rpc('swap_cancel', { p_swap: swapId });
    },
  };
}
