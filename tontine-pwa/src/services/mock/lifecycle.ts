// Cycle de vie d'une tontine simulée : statuts de paiement, pénalités, ouverture et clôture des tours.
import { computeDueDate, computePot, roundOpenDate } from '@/lib/tontine';
import { formatAmount } from '@/lib/format';
import type { Group, PaymentStatus, Round } from '@/types';
import { activeMemberships, requireGroup } from './access';
import { db, newId, nowIso } from './db';
import { hasPaidMembershipFee, recordReservedTurnEarning } from './revenue';
import { sendSmsToUser } from './sms';

/** Pénalité de retard appliquée à un membre pour un tour (0 si aucune). */
export function penaltyFor(roundId: string, userId: string): number {
  return db.penalties
    .filter((p) => p.roundId === roundId && p.userId === userId)
    .reduce((sum, p) => sum + p.amount, 0);
}

function hasPenalty(roundId: string, userId: string): boolean {
  return db.penalties.some((p) => p.roundId === roundId && p.userId === userId);
}

/**
 * Moment où un impayé devient « en retard » : date limite + délai de grâce
 * (Paramètres → Règles des tontines).
 */
export function lateAfter(round: Round): Date {
  const deadline = new Date(round.dueDate);
  deadline.setDate(deadline.getDate() + db.settings.rules.graceDays);
  return deadline;
}

/** Statut de paiement d'un membre pour un tour (un paiement « payé » l'emporte). */
export function memberStatus(round: Round, userId: string, now: Date = new Date()): PaymentStatus {
  const payments = db.payments.filter((p) => p.roundId === round.id && p.userId === userId);
  if (payments.some((p) => p.status === 'paid')) return 'paid';
  if (hasPenalty(round.id, userId) || lateAfter(round) < now) return 'late';
  const last = payments[payments.length - 1];
  if (last?.status === 'failed') return 'failed';
  return 'pending';
}

export function amountBreakdown(group: Group, round: Round, userId: string) {
  const shareCount = activeMemberships(group.id).filter((m) => m.userId === userId).length;
  const contributionPerShare =
    group.contributionAmount * (group.dailyContribution ? (group.turnDurationDays ?? 10) : 1);
  const contributionAmount = contributionPerShare * shareCount;
  const latePenaltyAmount = penaltyFor(round.id, userId);
  const membershipFee = hasPaidMembershipFee(group.id, userId)
    ? 0
    : (group.membershipFeeAmount ?? 0);
  return {
    contributionAmount,
    membershipFeeAmount: membershipFee,
    latePenaltyAmount,
    amount: contributionAmount + latePenaltyAmount + membershipFee,
  };
}

/** Montant dû par une personne pour toutes ses parts d'un tour, pénalité incluse. */
export function amountDue(group: Group, round: Round, userId: string): number {
  return amountBreakdown(group, round, userId).amount;
}

export function paidCount(round: Round): number {
  return activeMemberships(round.groupId).filter((m) => memberStatus(round, m.userId) === 'paid')
    .length;
}

/** Tours du cycle en cours d'un groupe, dans l'ordre. */
export function cycleRounds(group: Group): Round[] {
  return db.rounds
    .filter((r) => r.groupId === group.id && r.cycle === group.currentCycle)
    .sort((a, b) => a.number - b.number);
}

export function currentRoundOf(groupId: string): Round | undefined {
  return db.rounds.find(
    (r) => r.groupId === groupId && (r.status === 'open' || r.status === 'ready_for_payout'),
  );
}

export function notify(userId: string, type: string, title: string, body: string, link?: string) {
  db.notifications.unshift({
    id: newId('n'),
    userId,
    type,
    title,
    body,
    link,
    read: false,
    createdAt: nowIso(),
  });
}

export function notifyManagers(groupId: string, type: string, title: string, body: string) {
  const group = requireGroup(groupId);
  const notified = new Set<string>();
  const community = db.communities.find((item) => item.id === group.communityId);
  for (const adminId of [...(community?.adminIds ?? []), group.adminId]) {
    if (notified.has(adminId)) continue;
    notified.add(adminId);
    notify(adminId, type, title, body, `/admin/groupes/${groupId}`);
  }
  for (const membership of activeMemberships(groupId)) {
    if (
      (membership.role === 'owner' || membership.role === 'co_admin') &&
      !notified.has(membership.userId)
    ) {
      notified.add(membership.userId);
      notify(membership.userId, type, title, body, `/admin/groupes/${groupId}`);
    }
  }
}

/**
 * Applique d'office les pénalités : pour chaque tour ouvert dont la date limite est passée,
 * chaque membre qui n'a pas payé reçoit une pénalité (une seule fois) et une notification.
 * Le futur backend fera ce travail par une tâche planifiée.
 */
export function applyLatePenalties(now: Date = new Date()): boolean {
  let changed = false;
  for (const round of db.rounds) {
    if (round.status !== 'open' || lateAfter(round) >= now) continue;
    const group = requireGroup(round.groupId);
    const amount = group.latePenalty ?? 0;
    let lateCount = 0;
    const seenUsers = new Set<string>();
    for (const membership of activeMemberships(group.id)) {
      if (seenUsers.has(membership.userId)) continue;
      seenUsers.add(membership.userId);
      const paid = db.payments.some(
        (p) => p.roundId === round.id && p.userId === membership.userId && p.status === 'paid',
      );
      if (paid || hasPenalty(round.id, membership.userId)) continue;
      db.penalties.push({
        id: newId('pen'),
        roundId: round.id,
        userId: membership.userId,
        amount,
        appliedAt: now.toISOString(),
      });
      lateCount += 1;
      notify(
        membership.userId,
        'late',
        'Date limite dépassée',
        amount > 0
          ? `${group.name} : une pénalité de ${formatAmount(amount)} a été ajoutée. Total à payer : ${formatAmount(amountDue(group, round, membership.userId))}.`
          : `${group.name} : votre cotisation du tour ${round.number} est en retard.`,
        `/groupes/${group.id}`,
      );
    }
    if (lateCount > 0) {
      changed = true;
      notifyManagers(
        group.id,
        'late',
        'Membres en retard',
        `${group.name} : ${lateCount} membre(s) en retard sur le tour ${round.number}.`,
      );
    }
  }
  return changed;
}

/** Passe le tour en « prêt pour le reversement » quand tout le monde a payé. */
export function refreshRound(round: Round): void {
  if (round.status !== 'open') return;
  const members = activeMemberships(round.groupId);
  if (members.length > 0 && paidCount(round) === members.length) {
    round.status = 'ready_for_payout';
    const group = requireGroup(round.groupId);
    if (round.recipientType === 'platform') {
      for (const superAdmin of db.users.filter((user) => user.globalRole === 'super_admin')) {
        notify(
          superAdmin.id,
          'platform_income_ready',
          'Revenu plateforme prêt',
          `${group.name} : toutes les cotisations de la période réservée sont reçues.`,
          '/admin/versements',
        );
      }
    }
    notifyManagers(
      group.id,
      'ready_for_payout',
      'Tour prêt pour le reversement',
      `${group.name} : tous les membres ont payé le tour ${round.number}.`,
    );
  }
}

/** Crée tous les tours du cycle en cours à partir de l'ordre des bénéficiaires. */
export function createRounds(group: Group): void {
  const members = activeMemberships(group.id).sort(
    (a, b) => (a.payoutOrder ?? 0) - (b.payoutOrder ?? 0),
  );
  const start = new Date(group.startDate);
  const turnDays = group.turnDurationDays ?? 10;
  const contributionPerShare = group.contributionAmount * (group.dailyContribution ? turnDays : 1);
  const pot = computePot(contributionPerShare, members.length);
  const shareCountByUser = new Map<string, number>();
  for (const membership of members) {
    const shareNumber = (shareCountByUser.get(membership.userId) ?? 0) + 1;
    shareCountByUser.set(membership.userId, shareNumber);
  }
  const sharesPerRound = Math.max(1, group.sharesPerRound ?? 1);
  const batches: (typeof members)[] = [];
  for (let index = 0; index < members.length; index += sharesPerRound) {
    batches.push(members.slice(index, index + sharesPerRound));
  }
  const totalRounds = batches.length + (group.reserveFinalTurn ? 1 : 0);
  const platformUserId = db.users.find((user) => user.globalRole === 'super_admin')?.id;
  const makeRound = (
    number: number,
    batch: typeof members,
    recipientType: Round['recipientType'] = 'members',
  ) => {
    const openDate = group.dailyContribution
      ? new Date(start.getTime() + (number - 1) * turnDays * 86_400_000)
      : roundOpenDate(start, group.frequency, number - 1);
    const dueDate = group.dailyContribution
      ? new Date(openDate.getTime() + turnDays * 86_400_000)
      : computeDueDate(openDate, group.frequency, group.paymentDueDay);
    db.rounds.push({
      id: newId('r'),
      groupId: group.id,
      number,
      openDate: openDate.toISOString(),
      dueDate: dueDate.toISOString(),
      beneficiaryId: batch[0]?.userId ?? platformUserId ?? group.createdBy,
      beneficiaryMembershipIds: batch.map((membership) => membership.id),
      recipientType,
      beneficiaryShareCount: batch[0] ? shareCountByUser.get(batch[0].userId) : undefined,
      potAmount: pot,
      status: number === 1 ? 'open' : 'upcoming',
      cycle: group.currentCycle,
    });
  };
  batches.forEach((batch, index) => makeRound(index + 1, batch));
  if (group.reserveFinalTurn) makeRound(totalRounds, [], 'platform');
}

/** Clôture le tour reversé, ouvre le suivant du même cycle ou termine le groupe. */
export function closeRound(round: Round): void {
  const group = requireGroup(round.groupId);
  round.status = 'paid_out';
  round.paidOutAt = nowIso();
  const memberships = activeMemberships(group.id);
  if (round.recipientType === 'platform') {
    recordReservedTurnEarning(round, group);
  } else {
    const recipients = memberships.filter((membership) =>
      round.beneficiaryMembershipIds
        ? round.beneficiaryMembershipIds.includes(membership.id)
        : membership.userId === round.beneficiaryId,
    );
    const shareAmount = Math.floor(round.potAmount / Math.max(1, recipients.length));
    let remainder = round.potAmount - shareAmount * recipients.length;
    const amounts = new Map<string, number>();
    for (const membership of recipients) {
      const amount = shareAmount + (remainder > 0 ? 1 : 0);
      remainder = Math.max(0, remainder - 1);
      amounts.set(membership.userId, (amounts.get(membership.userId) ?? 0) + amount);
    }
    round.beneficiaryAmounts = Object.fromEntries(amounts);
    for (const [userId, amount] of amounts) {
      sendSmsToUser(userId, 'payout');
      notify(
        userId,
        'payout',
        'Cagnotte reçue',
        `Vous avez reçu ${formatAmount(amount)} de ${group.name}.`,
        `/groupes/${group.id}`,
      );
    }
  }
  const next = db.rounds.find(
    (r) => r.groupId === group.id && r.cycle === round.cycle && r.number === round.number + 1,
  );
  if (!next) {
    group.status = 'finished';
    notifyManagers(
      group.id,
      'cycle_finished',
      'Cycle terminé',
      `${group.name} : tous les membres ont reçu la cagnotte. Vous pouvez relancer un nouveau cycle.`,
    );
    return;
  }
  next.status = 'open';
  const nextRecipients = new Set(
    memberships
      .filter((membership) => next.beneficiaryMembershipIds?.includes(membership.id))
      .map((membership) => membership.userId),
  );
  const notified = new Set<string>();
  for (const membership of memberships) {
    if (!nextRecipients.has(membership.userId) || notified.has(membership.userId)) continue;
    notified.add(membership.userId);
    notify(
      membership.userId,
      'beneficiary',
      'Nouveau tour ouvert',
      next.recipientType === 'platform'
        ? `${group.name} : la période ${next.number} est réservée au Superadmin.`
        : `${group.name} : votre part est bénéficiaire au tour ${next.number}.`,
      `/groupes/${group.id}`,
    );
  }
}
