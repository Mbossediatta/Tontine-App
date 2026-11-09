// Cycle de vie d'une tontine simulée : statuts de paiement, pénalités, ouverture et clôture des tours.
import { ServiceError } from '@/lib/errors';
import {
  computeDueDate,
  computePot,
  contributionPerTurn,
  periodContribution,
  roundDeadline,
  roundOpenDate,
} from '@/lib/tontine';
import { formatAmount } from '@/lib/format';
import type { Group, PaymentStatus, Round } from '@/types';
import { activeMemberships, requireGroup } from './access';
import { db, newId, nowIso } from './db';
import { hasPaidMembershipFee, recordReservedTurnEarning } from './revenue';

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
  return roundDeadline(
    round.dueDate,
    db.settings.rules.graceDays,
    requireGroup(round.groupId).paymentDueTime,
  );
}

/**
 * Total du tour pour une personne : cotisation de toutes ses parts sur la durée du tour,
 * plus ses pénalités (comme private.round_total).
 */
export function roundTotal(group: Group, round: Round, userId: string): number {
  const shareCount = activeMemberships(group.id).filter((m) => m.userId === userId).length;
  return contributionPerTurn(group, round) * shareCount + penaltyFor(round.id, userId);
}

/** Déjà versé sur le tour : cotisation et pénalité des versements réussis. */
export function roundPaid(roundId: string, userId: string): number {
  return db.payments
    .filter((p) => p.roundId === roundId && p.userId === userId && p.status === 'paid')
    .reduce(
      (sum, p) =>
        sum +
        (p.contributionAmount === undefined
          ? p.amount - (p.membershipFeeAmount ?? 0)
          : p.contributionAmount + (p.latePenaltyAmount ?? 0)),
      0,
    );
}

/**
 * Statut de paiement d'un membre pour un tour : « payé » quand ses versements atteignent
 * le total du tour, « en retard » si ce n'est pas le cas à la date limite (+ grâce).
 */
export function memberStatus(round: Round, userId: string, now: Date = new Date()): PaymentStatus {
  const payments = db.payments.filter((p) => p.roundId === round.id && p.userId === userId);
  const total = roundTotal(requireGroup(round.groupId), round, userId);
  if (total > 0 && roundPaid(round.id, userId) >= total) return 'paid';
  if (hasPenalty(round.id, userId) || lateAfter(round) < now) return 'late';
  const last = payments[payments.length - 1];
  if (last?.status === 'failed') return 'failed';
  return 'pending';
}

/**
 * Montants d'un versement (comme private.installment) : `periods` périodes du rythme pour
 * toutes mes parts, ou tout le reste du tour. Les frais d'adhésion partent avec le premier
 * versement, la pénalité avec celui qui termine le tour.
 */
export function amountBreakdown(group: Group, round: Round, userId: string, periods?: number) {
  const shareCount = activeMemberships(group.id).filter((m) => m.userId === userId).length;
  const perPeriod = periodContribution(group, round) * shareCount;
  const paid = db.payments.filter(
    (p) => p.roundId === round.id && p.userId === userId && p.status === 'paid',
  );
  const paidContribution = paid.reduce((sum, p) => sum + (p.contributionAmount ?? p.amount), 0);
  const paidPenalty = paid.reduce((sum, p) => sum + (p.latePenaltyAmount ?? 0), 0);
  const rest = Math.max(0, contributionPerTurn(group, round) * shareCount - paidContribution);
  if (periods !== undefined && (periods < 1 || periods > group.turnLength)) {
    throw new ServiceError('Nombre de jours ou de périodes invalide.');
  }
  const contributionAmount = periods === undefined ? rest : Math.min(rest, perPeriod * periods);
  const latePenaltyAmount =
    contributionAmount >= rest ? Math.max(0, penaltyFor(round.id, userId) - paidPenalty) : 0;
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

/** Reste à payer par une personne sur un tour (toutes ses parts, pénalité incluse). */
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
      const paid =
        roundPaid(round.id, membership.userId) >= roundTotal(group, round, membership.userId);
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
  const pot = computePot(contributionPerTurn(group), members.length);
  // Période de service : la part réglée de la cotisation (platformSharePercent).
  const platformPot = computePot(
    contributionPerTurn(group, { recipientType: 'platform' }),
    members.length,
  );
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
    const openDate = roundOpenDate(start, group.frequency, number - 1, group.turnLength);
    const dueDate = computeDueDate(
      openDate,
      group.frequency,
      group.paymentDueDay,
      group.turnLength,
    );
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
      potAmount: recipientType === 'platform' ? platformPot : pot,
      status: number === 1 ? 'open' : 'upcoming',
      cycle: group.currentCycle,
    });
  };
  batches.forEach((batch, index) => makeRound(index + 1, batch));
  if (group.reserveFinalTurn) makeRound(totalRounds, [], 'platform');
}

function fullNameOf(userId: string): string {
  const user = db.users.find((item) => item.id === userId);
  return user ? `${user.firstName} ${user.lastName}` : 'un membre';
}

/**
 * Impayés au versement d'un tour (comme round_payout) : ce que chacun n'a pas versé
 * (cotisation et pénalité) devient une dette, et il est prévenu.
 */
function recordDebts(round: Round, group: Group): void {
  const seen = new Set<string>();
  for (const membership of activeMemberships(group.id)) {
    if (seen.has(membership.userId)) continue;
    seen.add(membership.userId);
    const shares = activeMemberships(group.id).filter((m) => m.userId === membership.userId).length;
    const paid = db.payments.filter(
      (p) => p.roundId === round.id && p.userId === membership.userId && p.status === 'paid',
    );
    const amount = Math.max(
      0,
      contributionPerTurn(group, round) * shares -
        paid.reduce((sum, p) => sum + (p.contributionAmount ?? p.amount), 0),
    );
    const penaltyAmount = Math.max(
      0,
      penaltyFor(round.id, membership.userId) -
        paid.reduce((sum, p) => sum + (p.latePenaltyAmount ?? 0), 0),
    );
    if (amount + penaltyAmount <= 0) continue;
    if (db.debts.some((debt) => debt.roundId === round.id && debt.userId === membership.userId)) {
      continue;
    }
    db.debts.push({
      id: newId('debt'),
      groupId: group.id,
      roundId: round.id,
      userId: membership.userId,
      amount,
      penaltyAmount,
      status: 'open',
      createdAt: nowIso(),
    });
    notify(
      membership.userId,
      'debt',
      'Cotisation impayée',
      `${group.name} : la cagnotte du tour ${round.number} a été versée sans votre cotisation. Vous devez ${formatAmount(amount + penaltyAmount)} ; sans remboursement, ce montant sera retenu sur votre cagnotte.`,
      `/groupes/${group.id}`,
    );
  }
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
    recordDebts(round, group);
    const recipients = memberships.filter((membership) =>
      round.beneficiaryMembershipIds
        ? round.beneficiaryMembershipIds.includes(membership.id)
        : membership.userId === round.beneficiaryId,
    );
    // Les bénéficiaires se partagent ce qui a réellement été collecté (comme round_payout).
    const collected = db.payments
      .filter((p) => p.roundId === round.id && p.status === 'paid')
      .reduce((sum, p) => sum + (p.contributionAmount ?? p.amount), 0);
    const shareAmount = Math.floor(collected / Math.max(1, recipients.length));
    let remainder = collected - shareAmount * recipients.length;
    const amounts = new Map<string, number>();
    for (const membership of recipients) {
      const amount = shareAmount + (remainder > 0 ? 1 : 0);
      remainder = Math.max(0, remainder - 1);
      amounts.set(membership.userId, (amounts.get(membership.userId) ?? 0) + amount);
    }
    // Dettes d'un bénéficiaire : retenues sur sa part.
    const withheld = new Map<string, number>();
    for (const [userId, amount] of amounts) {
      const open = db.debts.filter(
        (debt) => debt.groupId === group.id && debt.userId === userId && debt.status === 'open',
      );
      const owed = open.reduce((sum, debt) => sum + debt.amount + debt.penaltyAmount, 0);
      if (owed <= 0) continue;
      const taken = Math.min(amount, owed);
      amounts.set(userId, amount - taken);
      withheld.set(userId, taken);
      const penalties = open.reduce((sum, debt) => sum + debt.penaltyAmount, 0);
      if (penalties > 0) {
        db.platformEarnings.push({
          id: newId('earn'),
          groupId: group.id,
          roundId: round.id,
          kind: 'late_penalty',
          amount: penalties,
          at: nowIso(),
        });
      }
      for (const debt of open) {
        debt.status = 'settled';
        debt.settledVia = 'withheld';
        debt.settledAt = nowIso();
      }
      notifyManagers(
        group.id,
        'debt',
        'Dette retenue',
        `${group.name} : ${formatAmount(owed)} retenus sur la cagnotte de ${fullNameOf(userId)} (tour ${round.number}) pour rembourser ses impayés : à reverser aux bénéficiaires des tours concernés.`,
      );
    }
    round.beneficiaryAmounts = Object.fromEntries(amounts);
    for (const [userId, amount] of amounts) {
      const kept = withheld.get(userId) ?? 0;
      notify(
        userId,
        'payout',
        'Cagnotte reçue',
        `Vous avez reçu ${formatAmount(amount)} de ${group.name}${kept > 0 ? ` (${formatAmount(kept)} retenus pour vos impayés)` : ''}.`,
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
