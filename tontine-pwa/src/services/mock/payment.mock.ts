import { ServiceError } from '@/lib/errors';
import { serviceFee } from '@/lib/tontine';
import { formatAmount, fullName } from '@/lib/format';
import type { MyTransaction } from '@/types';
import type { PaymentService } from '../payment.service';
import {
  activeMemberships,
  assertCanManage,
  assertCanView,
  canManage,
  membershipOf,
  requireGroup,
  requireRound,
} from './access';
import { currentUser, db, delay, newId, nowIso, persist, requireOnline, requireUser } from './db';
import { recordAudit } from './audit';
import { assertGroupOpen } from './platform';
import { synchronize } from './clock';
import {
  amountBreakdown,
  memberStatus,
  notify,
  notifyManagers,
  penaltyFor,
  refreshRound,
  roundPaid,
  roundTotal,
} from './lifecycle';
import { toPublicUser } from './views';
import { recordPaymentEarnings } from './revenue';

export const mockPaymentService: PaymentService = {
  async listForRound(roundId) {
    await delay();
    synchronize();
    const round = requireRound(roundId);
    const group = requireGroup(round.groupId);
    assertCanManage(group, currentUser());
    const memberships = activeMemberships(group.id);
    const byUser = new Map<string, (typeof memberships)[number]>();
    const shareCounts = new Map<string, number>();
    for (const membership of memberships) {
      if (!byUser.has(membership.userId)) byUser.set(membership.userId, membership);
      shareCounts.set(membership.userId, (shareCounts.get(membership.userId) ?? 0) + 1);
    }
    return [...byUser.values()].map((membership) => {
      const payments = db.payments.filter(
        (p) => p.roundId === roundId && p.userId === membership.userId,
      );
      const paid = payments.filter((p) => p.status === 'paid');
      return {
        user: toPublicUser(requireUser(membership.userId), true),
        status: memberStatus(round, membership.userId),
        // Le dernier versement réussi, sinon le dernier essai.
        payment: paid[paid.length - 1] ?? payments[payments.length - 1],
        shareCount: shareCounts.get(membership.userId) ?? 1,
        penalty: penaltyFor(roundId, membership.userId),
        paidAmount: roundPaid(roundId, membership.userId),
        totalAmount: roundTotal(group, round, membership.userId),
      };
    });
  },

  async listDebts(groupId) {
    await delay();
    synchronize();
    const user = currentUser();
    const group = requireGroup(groupId);
    const manager = canManage(group, user);
    return db.debts
      .filter((debt) => debt.groupId === groupId && (manager || debt.userId === user.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((debt) => ({
        debt,
        user: toPublicUser(requireUser(debt.userId), manager),
        roundNumber: requireRound(debt.roundId).number,
      }));
  },

  async payDebt(debtId, method) {
    requireOnline();
    await delay();
    const user = currentUser();
    const debt = db.debts.find((item) => item.id === debtId && item.userId === user.id);
    if (!debt) throw new ServiceError('Cette dette est introuvable.', 'not_found');
    if (debt.status !== 'open') throw new ServiceError('Cette dette est déjà réglée.', 'conflict');
    const amount = debt.amount + debt.penaltyAmount;
    const payment = {
      id: newId('pay'),
      roundId: debt.roundId,
      userId: user.id,
      debtId: debt.id,
      amount,
      contributionAmount: debt.amount,
      membershipFeeAmount: 0,
      latePenaltyAmount: debt.penaltyAmount,
      serviceFeeAmount: serviceFee(amount, db.settings.payment.feePercent),
      method,
      providerRef: `SIM-${Date.now().toString(36).toUpperCase()}`,
      status: 'pending' as const,
      createdAt: nowIso(),
    };
    db.payments.push(payment);
    persist();
    return {
      paymentId: payment.id,
      checkoutUrl: `/paiement/simulation?payment=${encodeURIComponent(payment.id)}`,
    };
  },

  async recordDebtPayment(debtId) {
    requireOnline();
    await delay();
    const debt = db.debts.find((item) => item.id === debtId);
    if (!debt) throw new ServiceError('Cette dette n’existe pas.', 'not_found');
    const group = requireGroup(debt.groupId);
    const actor = currentUser();
    assertCanManage(group, actor);
    if (debt.status !== 'open') throw new ServiceError('Cette dette est déjà réglée.');
    debt.status = 'settled';
    debt.settledVia = 'cash';
    debt.settledAt = nowIso();
    if (debt.penaltyAmount > 0) {
      db.platformEarnings.push({
        id: newId('earn'),
        groupId: group.id,
        roundId: debt.roundId,
        kind: 'late_penalty',
        amount: debt.penaltyAmount,
        at: nowIso(),
      });
    }
    const round = requireRound(debt.roundId);
    recordAudit(
      actor,
      'cash_recorded',
      `a enregistré le remboursement de ${formatAmount(debt.amount + debt.penaltyAmount)} de ${fullName(requireUser(debt.userId))} (impayé du tour ${round.number}) — ${group.name}`,
      group.id,
    );
    notify(
      debt.userId,
      'debt',
      'Dette remboursée',
      `${group.name} : votre remboursement de ${formatAmount(debt.amount + debt.penaltyAmount)} (tour ${round.number}) est enregistré.`,
      `/groupes/${group.id}`,
    );
    persist();
  },

  async myTransactions() {
    await delay();
    synchronize();
    const user = currentUser();
    const rounds = new Map(db.rounds.map((r) => [r.id, r]));
    const groupName = (groupId: string) => db.groups.find((g) => g.id === groupId)?.name ?? '—';

    // Cotisations : les lignes « en retard » ne sont pas des paiements, on les écarte.
    const contributions: MyTransaction[] = db.payments
      .filter((p) => p.userId === user.id && p.status !== 'late')
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
            groupName: groupName(round.groupId),
            roundNumber: round.number,
            cycle: round.cycle,
            payment,
          },
        ];
      });

    // Cagnottes reçues : même règle que l'historique d'un groupe (tours à plusieurs bénéficiaires).
    const payouts: MyTransaction[] = db.rounds.flatMap((round) => {
      if (round.status !== 'paid_out' || round.recipientType === 'platform' || !round.paidOutAt) {
        return [];
      }
      const amount = round.beneficiaryAmounts
        ? (round.beneficiaryAmounts[user.id] ?? 0)
        : round.beneficiaryId === user.id
          ? round.potAmount
          : 0;
      if (amount <= 0) return [];
      return [
        {
          kind: 'payout' as const,
          id: `payout-${round.id}`,
          date: round.paidOutAt,
          groupId: round.groupId,
          groupName: groupName(round.groupId),
          roundNumber: round.number,
          amount,
        },
      ];
    });

    return [...contributions, ...payouts].sort((a, b) => b.date.localeCompare(a.date));
  },

  async listMine(groupId) {
    await delay();
    synchronize();
    const user = currentUser();
    const group = requireGroup(groupId);
    assertCanView(group, user);
    const rounds = db.rounds.filter((r) => r.groupId === groupId);
    const roundOf = new Map(rounds.map((r) => [r.id, r]));
    return {
      payments: db.payments
        .filter((p) => p.userId === user.id && roundOf.has(p.roundId) && p.status !== 'late')
        .map((payment) => ({
          payment,
          roundNumber: roundOf.get(payment.roundId)?.number ?? 0,
          cycle: roundOf.get(payment.roundId)?.cycle ?? 1,
        }))
        .sort((a, b) => (b.payment.paidAt ?? '').localeCompare(a.payment.paidAt ?? '')),
      received: rounds.filter(
        (round) =>
          round.status === 'paid_out' &&
          round.recipientType !== 'platform' &&
          (round.beneficiaryAmounts
            ? (round.beneficiaryAmounts[user.id] ?? 0) > 0
            : round.beneficiaryId === user.id),
      ),
    };
  },

  async initiatePayment({ roundId, method, periods }) {
    requireOnline();
    await delay();
    const user = currentUser();
    const round = requireRound(roundId);
    const group = requireGroup(round.groupId);
    if (membershipOf(group.id, user.id)?.status !== 'active') {
      throw new ServiceError('Vous ne faites pas partie de ce groupe.', 'forbidden');
    }
    assertGroupOpen(group);
    if (round.status !== 'open') throw new ServiceError('Ce tour n’accepte plus de paiement.');
    const status = memberStatus(round, user.id);
    if (status === 'paid') throw new ServiceError('Vous avez déjà payé ce tour.', 'conflict');
    const breakdown = amountBreakdown(group, round, user.id, periods);
    const payment = {
      id: newId('pay'),
      roundId,
      userId: user.id,
      ...breakdown,
      // Frais PayTech payés par le membre, en plus (jamais dans la cagnotte).
      serviceFeeAmount: serviceFee(breakdown.amount, db.settings.payment.feePercent),
      method,
      providerRef: `SIM-${Date.now().toString(36).toUpperCase()}`,
      status: 'pending' as const,
      createdAt: nowIso(),
    };
    db.payments.push(payment);
    persist();
    return {
      paymentId: payment.id,
      checkoutUrl: `/paiement/simulation?payment=${encodeURIComponent(payment.id)}`,
    };
  },

  async getReceipt(paymentId) {
    await delay();
    synchronize();
    const user = currentUser();
    const payment = db.payments.find((p) => p.id === paymentId);
    if (!payment || payment.userId !== user.id) {
      throw new ServiceError('Paiement introuvable.', 'not_found');
    }
    const round = requireRound(payment.roundId);
    const group = requireGroup(round.groupId);
    return {
      payment: { ...payment },
      groupId: group.id,
      groupName: group.name,
      roundNumber: round.number,
      cycle: round.cycle,
    };
  },

  async recordCash(roundId, userId, periods) {
    requireOnline();
    await delay();
    const round = requireRound(roundId);
    const group = requireGroup(round.groupId);
    const actor = currentUser();
    assertCanManage(group, actor);
    assertGroupOpen(group);
    if (round.status !== 'open') throw new ServiceError('Ce tour n’accepte plus de paiement.');
    const status = memberStatus(round, userId);
    if (status === 'paid') throw new ServiceError('Ce membre a déjà payé.');
    const breakdown = amountBreakdown(group, round, userId, periods);
    const amount = breakdown.amount;
    db.payments.push({
      id: newId('pay'),
      roundId,
      userId,
      amount,
      contributionAmount: breakdown.contributionAmount,
      membershipFeeAmount: breakdown.membershipFeeAmount,
      latePenaltyAmount: breakdown.latePenaltyAmount,
      method: 'cash',
      status: 'paid',
      paidAt: nowIso(),
      createdAt: nowIso(),
    });
    const cashPayment = db.payments[db.payments.length - 1];
    if (cashPayment) recordPaymentEarnings(cashPayment, group);
    recordAudit(
      actor,
      'cash_recorded',
      `a enregistré ${formatAmount(amount)} en espèces de ${fullName(requireUser(userId))} — ${group.name}`,
      group.id,
    );
    notify(
      userId,
      'payment',
      'Paiement en espèces enregistré',
      `${group.name} : ${formatAmount(amount)} reçus pour le tour ${round.number}.`,
      `/groupes/${group.id}`,
    );
    notifyManagers(
      group.id,
      'payment',
      'Paiement reçu',
      `${fullName(requireUser(userId))} a payé ${formatAmount(amount)} en espèces.`,
    );
    refreshRound(round);
    persist();
  },

  async remindLate(roundId) {
    requireOnline();
    await delay();
    return remind(roundId);
  },

  async remindMember(roundId, userId) {
    requireOnline();
    await delay();
    await remind(roundId, userId);
  },
};

/**
 * Relance (comme reminder_send) : ceux qui n'ont pas payé et pas encore été relancés
 * aujourd'hui reçoivent une notification (push sur le téléphone) ; l'action est tracée.
 */
function remind(roundId: string, userId?: string): number {
  const round = requireRound(roundId);
  const group = requireGroup(round.groupId);
  const actor = currentUser();
  assertCanManage(group, actor);
  const today = nowIso().slice(0, 10);
  const remindedToday = (id: string) =>
    db.reminders.some((r) => r.roundId === round.id && r.userId === id && r.day === today);
  if (userId) {
    if (membershipOf(group.id, userId)?.status !== 'active') {
      throw new ServiceError('Ce membre ne fait pas partie de ce groupe.', 'forbidden');
    }
    // Inutile de relancer quelqu'un qui a déjà payé.
    if (memberStatus(round, userId) === 'paid') throw new ServiceError('Ce membre a déjà payé.');
    if (remindedToday(userId)) {
      throw new ServiceError(
        'Ce membre a déjà été relancé aujourd’hui. Réessayez demain.',
        'conflict',
      );
    }
  }
  const unpaid = [
    ...new Set(
      activeMemberships(group.id)
        .map((membership) => membership.userId)
        .filter((id) => (!userId || id === userId) && memberStatus(round, id) !== 'paid'),
    ),
  ];
  const targets = unpaid.filter((id) => !remindedToday(id));
  if (unpaid.length > 0 && targets.length === 0) {
    throw new ServiceError(
      'Les membres qui n’ont pas payé ont déjà été relancés aujourd’hui. Réessayez demain.',
      'conflict',
    );
  }
  for (const id of targets) {
    db.reminders.push({ roundId: round.id, userId: id, day: today });
    notify(
      id,
      'reminder',
      'Rappel de cotisation',
      `${group.name} : merci de payer votre cotisation du tour ${round.number}.`,
      `/groupes/${group.id}`,
    );
  }
  if (targets.length > 0) {
    const [only] = targets;
    const who =
      targets.length === 1 && only ? fullName(requireUser(only)) : `${targets.length} membres`;
    recordAudit(
      actor,
      'reminder_sent',
      `a relancé ${who} pour le tour ${round.number} de « ${group.name} »`,
      group.id,
    );
  }
  persist();
  return targets.length;
}
