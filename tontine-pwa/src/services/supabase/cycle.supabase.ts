// Tours, paiements et échanges de tour sur Supabase.
// Branchés : ordre des bénéficiaires, tours, statuts, paiements en espèces, versement
// (backend/supabase/migrations/…_cycle.sql). Paiement en ligne PayTech, rappels SMS et
// échanges de tour : étapes suivantes du backend, avec un message clair d'ici là.
import { ServiceError } from '@/lib/errors';
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

const NOT_READY = (what: string) =>
  new ServiceError(`${what} arrive avec l’étape suivante du serveur.`, 'conflict');

/** Bénéficiaire affiché pour la période réservée au super admin. */
const PLATFORM: PublicUser = { id: '', firstName: 'Calebasse', lastName: 'de l’Espoir' };

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
  const shareValue = Math.floor(round.potAmount / Math.max(1, recipients.length));
  let remainder = round.potAmount - shareValue * recipients.length;
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
    beneficiary: beneficiaries[0] ?? PLATFORM,
    beneficiaries,
    beneficiaryShares,
    paidCount: paidCountOf(ctx, round),
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
      await rpc('round_payout', { p_round: roundId });
    },
  };
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
        return {
          user: person(ctx, userId, true),
          status: memberStatus(ctx, round, userId),
          payment: payments.find((payment) => payment.status === 'paid') ?? payments.at(-1),
          shareCount,
          penalty: penaltyFor(ctx, roundId, userId),
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

    async initiatePayment({ roundId, method }) {
      return invoke<InitiatePaymentResult>(
        'payments-initiate',
        { roundId, method },
        'Le service de paiement est indisponible pour le moment. Réessayez dans quelques minutes.',
      );
    },

    async getReceipt(paymentId) {
      return rpc<PaymentReceipt>('payment_receipt', { p_payment: paymentId });
    },

    async recordCash(roundId, userId) {
      requireOnline();
      await rpc('payment_record_cash', { p_round: roundId, p_user: userId });
    },

    async remindLate() {
      throw NOT_READY('L’envoi des rappels');
    },

    async remindMember() {
      throw NOT_READY('L’envoi des rappels');
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

export function createSupabaseSwapService(): SwapService {
  return {
    async list(groupId) {
      const result = await supabase()
        .from('swap_requests')
        .select('id')
        .eq('group_id', groupId)
        .limit(1);
      if (rows<{ id: string }>(result).length > 0) throw NOT_READY('L’affichage des échanges');
      return [];
    },
    async request() {
      throw NOT_READY('L’échange de tour');
    },
    async respond() {
      throw NOT_READY('L’échange de tour');
    },
    async decide() {
      throw NOT_READY('L’échange de tour');
    },
    async cancel() {
      throw NOT_READY('L’échange de tour');
    },
  };
}
