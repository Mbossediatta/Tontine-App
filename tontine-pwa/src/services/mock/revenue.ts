import type { Group, Payment, Round } from '@/types';
import { db, newId, nowIso, requireUser } from './db';
import { roundContributionCollected } from './metrics';

export function hasPaidMembershipFee(groupId: string, userId: string): boolean {
  return db.platformEarnings.some(
    (earning) =>
      earning.groupId === groupId && earning.userId === userId && earning.kind === 'membership_fee',
  );
}

export function recordPaymentEarnings(payment: Payment, group: Group): void {
  const at = payment.paidAt ?? nowIso();
  const additions = [
    { kind: 'membership_fee' as const, amount: payment.membershipFeeAmount ?? 0 },
    { kind: 'late_penalty' as const, amount: payment.latePenaltyAmount ?? 0 },
  ];
  for (const earning of additions) {
    if (
      earning.amount > 0 &&
      !db.platformEarnings.some((row) => row.paymentId === payment.id && row.kind === earning.kind)
    ) {
      db.platformEarnings.push({
        id: newId('earn'),
        groupId: group.id,
        userId: payment.userId,
        paymentId: payment.id,
        kind: earning.kind,
        amount: earning.amount,
        at,
      });
    }
  }
}

export function recordReservedTurnEarning(round: Round, group: Group): void {
  if (
    !round.recipientType ||
    round.recipientType !== 'platform' ||
    db.platformEarnings.some((earning) => earning.roundId === round.id)
  ) {
    return;
  }
  const amount = roundContributionCollected(round);
  if (amount <= 0) return;
  db.platformEarnings.push({
    id: newId('earn'),
    groupId: group.id,
    roundId: round.id,
    kind: 'reserved_turn',
    amount,
    at: nowIso(),
  });
}

export function earningsBalance(groupId: string): number {
  const earned = db.platformEarnings
    .filter((entry) => entry.groupId === groupId)
    .reduce((sum, entry) => sum + entry.amount, 0);
  const paid = db.adminCompensations
    .filter((entry) => entry.groupId === groupId)
    .reduce((sum, entry) => sum + entry.amount, 0);
  return Math.max(0, earned - paid);
}

export function platformIncomeRows() {
  return db.platformEarnings.map((earning) => {
    const group = db.groups.find((item) => item.id === earning.groupId);
    const member = earning.userId ? requireUser(earning.userId) : undefined;
    return {
      ...earning,
      groupName: group?.name ?? 'Groupe supprimé',
      memberName: member ? `${member.firstName} ${member.lastName}` : undefined,
    };
  });
}
