// Denthie simulé (« garderie ») : mêmes règles que la migration …_denthie.sql.
// Périodes ouvertes l'une après l'autre jusqu'à la date de répartition, clôturées à leur heure
// limite ; répartition finale et retrait d'urgence sous forme de tours de versement.
import { startOfDay } from 'date-fns';
import { ServiceError } from '@/lib/errors';
import { formatAmount, formatDate, fullName } from '@/lib/format';
import { computeDueDate, roundOpenDate } from '@/lib/tontine';
import type { Group, Round, User } from '@/types';
import { activeMemberships, assertNotOwnMoney, isSuperAdmin } from './access';
import { recordAudit } from './audit';
import { db, newId, nowIso } from './db';
import { applyLatePenalties, lateAfter, notify, notifyManagers, penaltyFor } from './lifecycle';

/** Même seuil que la seconde validation des cagnottes. */
const APPROVAL_THRESHOLD = 300_000;

export function isDenthie(group: Pick<Group, 'kind'>): boolean {
  return group.kind === 'denthie';
}

function groupRounds(group: Group): Round[] {
  return db.rounds
    .filter((r) => r.groupId === group.id && r.cycle === group.currentCycle)
    .sort((a, b) => a.number - b.number);
}

function periods(group: Group): Round[] {
  return groupRounds(group).filter((r) => (r.purpose ?? 'turn') === 'turn');
}

function nextNumber(group: Group): number {
  return groupRounds(group).reduce((max, r) => Math.max(max, r.number), 0) + 1;
}

/** Épargne d'une personne : ses cotisations payées sur les périodes du cycle en cours. */
export function denthieSaved(group: Group, userId: string): number {
  const ids = new Set(periods(group).map((r) => r.id));
  return db.payments
    .filter((p) => ids.has(p.roundId) && p.userId === userId && p.status === 'paid')
    .reduce((sum, p) => sum + (p.contributionAmount ?? 0), 0);
}

function distributionOf(group: Group): Round | undefined {
  return groupRounds(group).find((r) => r.purpose === 'distribution');
}

/** Ouvre la période suivante s'il n'y en a pas d'ouverte et que la répartition n'est pas atteinte. */
export function openPeriod(group: Group): Round | undefined {
  if (!isDenthie(group) || group.status !== 'active' || distributionOf(group)) return undefined;
  const done = periods(group);
  if (done.some((r) => r.status !== 'paid_out')) return undefined;
  const openDate = roundOpenDate(new Date(group.startDate), group.frequency, done.length, 1);
  if (group.endDate && openDate >= new Date(group.endDate)) return undefined;
  const round: Round = {
    id: newId('r'),
    groupId: group.id,
    number: nextNumber(group),
    openDate: openDate.toISOString(),
    dueDate: computeDueDate(openDate, group.frequency, group.paymentDueDay, 1).toISOString(),
    beneficiaryId: '',
    beneficiaryMembershipIds: [],
    recipientType: 'members',
    purpose: 'turn',
    potAmount: group.contributionAmount * activeMemberships(group.id).length,
    status: 'open',
    cycle: group.currentCycle,
  };
  db.rounds.push(round);
  return round;
}

/** Clôt une période : la pénalité impayée devient une dette ; rien n'est dû aux autres. */
function closePeriod(group: Group, round: Round): void {
  const members = activeMemberships(group.id);
  for (const userId of new Set(members.map((m) => m.userId))) {
    const shares = members.filter((m) => m.userId === userId).length;
    const paid = db.payments.filter(
      (p) => p.roundId === round.id && p.userId === userId && p.status === 'paid',
    );
    const contributionLeft =
      group.contributionAmount * shares - paid.reduce((s, p) => s + (p.contributionAmount ?? 0), 0);
    const penaltyLeft = Math.max(
      0,
      penaltyFor(round.id, userId) - paid.reduce((s, p) => s + (p.latePenaltyAmount ?? 0), 0),
    );
    if (penaltyLeft > 0 && !db.debts.some((d) => d.roundId === round.id && d.userId === userId)) {
      db.debts.push({
        id: newId('debt'),
        groupId: group.id,
        roundId: round.id,
        userId,
        amount: 0,
        penaltyAmount: penaltyLeft,
        status: 'open',
        createdAt: nowIso(),
      });
    }
    if (contributionLeft > 0) {
      notify(
        userId,
        'debt',
        'Période close',
        `${group.name} : la période du ${formatDate(round.openDate)} est close sans toute votre cotisation (${formatAmount(contributionLeft)} non épargnés).${penaltyLeft > 0 ? ` Pénalité de ${formatAmount(penaltyLeft)} à régler, sinon elle sera retenue à la répartition.` : ''}`,
        `/groupes/${group.id}`,
      );
    }
  }
  round.status = 'paid_out';
  round.paidOutAt = nowIso();
}

/** Comme la tâche planifiée private.denthie_tick. Renvoie true si quelque chose a changé. */
export function denthieTick(now: Date = new Date()): boolean {
  let changed = false;
  for (const group of db.groups.filter((g) => isDenthie(g) && g.status === 'active')) {
    let closed = false;
    for (const round of periods(group)) {
      if (round.status === 'paid_out' || lateAfter(round) > now) continue;
      closePeriod(group, round);
      closed = true;
      changed = true;
    }
    const opened = openPeriod(group);
    if (opened) {
      changed = true;
      for (const userId of new Set(activeMemberships(group.id).map((m) => m.userId))) {
        const shares = activeMemberships(group.id).filter((m) => m.userId === userId).length;
        notify(
          userId,
          'new_period',
          'Nouvelle période',
          `${group.name} : cotisation de ${formatAmount(group.contributionAmount * shares)} à verser avant le ${formatDate(opened.dueDate)}.`,
          `/groupes/${group.id}`,
        );
      }
    } else if (closed && group.endDate && periods(group).every((r) => r.status === 'paid_out')) {
      notifyManagers(
        group.id,
        'denthie_end',
        'Denthie terminé',
        `${group.name} : toutes les périodes sont closes. Lancez la répartition à partir du ${formatDate(group.endDate)}.`,
      );
    }
  }
  return changed;
}

/** Démarrage d'un Denthie : liste close, parts numérotées, première période ouverte. */
export function startDenthie(group: Group, actor: User): void {
  const members = activeMemberships(group.id);
  if (new Set(members.map((m) => m.userId)).size < 2) {
    throw new ServiceError('Un Denthie doit avoir au moins deux personnes distinctes.');
  }
  if (new Date(group.startDate) < startOfDay(new Date())) {
    throw new ServiceError(
      'La date de démarrage est passée : choisissez-en une nouvelle dans les réglages.',
    );
  }
  if (group.endDate && new Date(group.endDate) <= new Date(group.startDate)) {
    throw new ServiceError('La date de répartition doit venir après le démarrage.');
  }
  [...members]
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
    .forEach((membership, index) => {
      membership.payoutOrder = index + 1;
    });
  group.status = 'active';
  group.maxMembers = members.length;
  const first = openPeriod(group);
  for (const userId of new Set(members.map((m) => m.userId))) {
    notify(
      userId,
      'started',
      'Le Denthie démarre',
      `${group.name} a démarré : première cotisation de ${formatAmount(group.contributionAmount)} avant le ${first ? formatDate(first.dueDate) : '—'}. L’argent est gardé jusqu’à la répartition.`,
      `/groupes/${group.id}`,
    );
  }
  recordAudit(actor, 'group_updated', `a démarré le Denthie « ${group.name} »`, group.id);
}

function assertDenthie(group: Group): void {
  if (!isDenthie(group)) throw new ServiceError('Réservé aux Denthie.');
  if (group.status === 'suspended') {
    throw new ServiceError('Ce groupe est suspendu par l’administration de la plateforme.');
  }
  if (group.status === 'finished') throw new ServiceError('Ce groupe est clôturé.');
}

export function setEndDate(group: Group, actor: User, endDate: string | null): void {
  assertDenthie(group);
  if (distributionOf(group)) throw new ServiceError('La répartition est déjà lancée.');
  const date = endDate ? new Date(`${endDate.slice(0, 10)}T00:00:00Z`) : null;
  if (date) {
    if (date <= new Date()) throw new ServiceError('Choisissez une date à venir.');
    if (date <= new Date(group.startDate)) {
      throw new ServiceError(
        `La répartition doit venir après le démarrage (${formatDate(group.startDate)}).`,
      );
    }
    const current = periods(group).at(-1);
    if (current && date <= new Date(current.openDate)) {
      throw new ServiceError(
        `Choisissez une date après le début de la période en cours (${formatDate(current.openDate)}).`,
      );
    }
  }
  group.endDate = date?.toISOString();
  for (const userId of new Set(activeMemberships(group.id).map((m) => m.userId))) {
    if (userId === actor.id) continue;
    notify(
      userId,
      'denthie_end_date',
      'Date de répartition',
      date
        ? `${group.name} : la répartition est prévue le ${formatDate(date.toISOString())}. Les cotisations s’arrêtent à cette date.`
        : `${group.name} : la date de répartition est retirée, les cotisations continuent.`,
      `/groupes/${group.id}`,
    );
  }
  recordAudit(
    actor,
    'group_updated',
    date
      ? `a fixé la répartition au ${formatDate(date.toISOString())} — ${group.name}`
      : `a retiré la date de répartition — ${group.name}`,
    group.id,
  );
  openPeriod(group);
}

/** Bénéficiaires d'un tour de versement : l'épargne de chacun (dettes retenues ensuite). */
function fillPayout(group: Group, round: Round, userIds: string[]): void {
  const amounts: Record<string, number> = {};
  for (const userId of userIds) {
    const saved = denthieSaved(group, userId);
    if (saved <= 0) continue;
    amounts[userId] = saved;
  }
  round.beneficiaryMembershipIds = activeMemberships(group.id)
    .filter((m) => amounts[m.userId] !== undefined)
    .map((m) => m.id);
  round.beneficiaryAmounts = amounts;
  round.beneficiaryId = Object.keys(amounts)[0] ?? '';
}

function withholdDebts(group: Group, round: Round): Record<string, number> {
  const withheld: Record<string, number> = {};
  for (const [userId, amount] of Object.entries(round.beneficiaryAmounts ?? {})) {
    const open = db.debts.filter(
      (d) => d.groupId === group.id && d.userId === userId && d.status === 'open',
    );
    const owed = open.reduce((s, d) => s + d.amount + d.penaltyAmount, 0);
    if (owed <= 0) continue;
    const taken = Math.min(amount, owed);
    round.beneficiaryAmounts = { ...round.beneficiaryAmounts, [userId]: amount - taken };
    withheld[userId] = taken;
    const penalties = open.reduce((s, d) => s + d.penaltyAmount, 0);
    if (penalties > 0) {
      db.platformEarnings.push({
        id: newId('earn'),
        groupId: group.id,
        roundId: round.id,
        userId,
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
  }
  return withheld;
}

function assertPayoutPhones(group: Group, userIds: string[]): void {
  for (const userId of userIds) {
    const user = db.users.find((u) => u.id === userId);
    if (user && !user.payoutPhone && denthieSaved(group, userId) > 0) {
      throw new ServiceError(
        `${fullName(user)} n’a pas renseigné de numéro de reversement (Profil).`,
      );
    }
  }
}

export function distribute(group: Group, actor: User): 'paid' | 'pending_approval' {
  assertDenthie(group);
  if (group.status !== 'active') throw new ServiceError('Ce Denthie n’a pas démarré.');
  if (!group.endDate) throw new ServiceError('Fixez d’abord la date de répartition.');
  if (new Date(group.endDate) > new Date()) {
    throw new ServiceError(`La répartition se lance à partir du ${formatDate(group.endDate)}.`);
  }
  let round = distributionOf(group);
  if (round?.payoutBlockedAt) {
    throw new ServiceError(
      `Répartition bloquée par l’administration de la plateforme : ${round.payoutBlockReason ?? 'vérification en cours'}.`,
    );
  }
  applyLatePenalties();
  for (const period of periods(group)) {
    if (period.status !== 'paid_out') closePeriod(group, period);
  }
  const members = [...new Set(activeMemberships(group.id).map((m) => m.userId))];
  assertPayoutPhones(group, members);
  const total = members.reduce((s, userId) => s + denthieSaved(group, userId), 0);
  if (!round) {
    round = {
      id: newId('r'),
      groupId: group.id,
      number: nextNumber(group),
      openDate: nowIso(),
      dueDate: nowIso(),
      beneficiaryId: '',
      recipientType: 'members',
      purpose: 'distribution',
      potAmount: total,
      status: 'upcoming',
      cycle: group.currentCycle,
    };
    db.rounds.push(round);
  }
  round.potAmount = total;
  fillPayout(group, round, members);
  assertNotOwnMoney(
    actor,
    members,
    'Vous êtes bénéficiaire de ce tour : c’est l’administrateur du groupe qui valide ce versement.',
  );
  if (total >= APPROVAL_THRESHOLD && !isSuperAdmin(actor)) {
    if (!round.payoutRequestedAt) {
      round.payoutRequestedAt = nowIso();
      for (const superAdmin of db.users.filter((u) => u.globalRole === 'super_admin')) {
        notify(
          superAdmin.id,
          'payout_approval',
          'Répartition à valider',
          `${group.name} : répartition de ${formatAmount(total)} entre les membres du Denthie, à valider.`,
          '/admin/versements',
        );
      }
      recordAudit(
        actor,
        'denthie_distribution',
        `a demandé la validation de la répartition (${formatAmount(total)}) — ${group.name}`,
        group.id,
      );
    }
    return 'pending_approval';
  }
  round.status = 'paid_out';
  round.paidOutAt = nowIso();
  round.payoutValidatedBy = actor.id;
  const withheld = withholdDebts(group, round);
  group.status = 'finished';
  for (const [userId, amount] of Object.entries(round.beneficiaryAmounts ?? {})) {
    const kept = withheld[userId] ?? 0;
    notify(
      userId,
      'payout',
      'Répartition validée',
      `${group.name} : votre épargne de ${formatAmount(amount)} est validée, elle va vous être envoyée${kept > 0 ? ` (${formatAmount(kept)} retenus pour vos pénalités)` : ''}.`,
      `/groupes/${group.id}`,
    );
  }
  notifyManagers(
    group.id,
    'denthie_distribution',
    'Répartition validée',
    `${group.name} : envoyez maintenant à chaque membre sa part (Tours → Cagnottes à envoyer).`,
  );
  recordAudit(
    actor,
    'denthie_distribution',
    `a validé la répartition de ${formatAmount(total)} — ${group.name}`,
    group.id,
  );
  return 'paid';
}

function cleanReason(reason: string, message: string): string {
  const text = reason.trim();
  if (text.length < 4 || text.length > 300) throw new ServiceError(message);
  return text;
}

export function requestWithdrawal(group: Group, actor: User, reason: string): void {
  if (!isDenthie(group) || group.status !== 'active') {
    throw new ServiceError('Le retrait d’urgence concerne un Denthie en cours.');
  }
  if (!activeMemberships(group.id).some((m) => m.userId === actor.id)) {
    throw new ServiceError('Vous ne faites pas partie de ce Denthie.', 'forbidden');
  }
  const text = cleanReason(reason, 'Expliquez en quelques mots la raison de l’urgence.');
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  if (
    db.auditLog.some(
      (e) =>
        e.actorId === actor.id &&
        e.groupId === group.id &&
        e.action === 'withdrawal_requested' &&
        new Date(e.at).getTime() > dayAgo,
    )
  ) {
    throw new ServiceError('Votre demande a déjà été envoyée : l’administrateur va vous répondre.');
  }
  notifyManagers(
    group.id,
    'withdrawal_request',
    'Demande de retrait d’urgence',
    `${fullName(actor)} demande à retirer son épargne de ${group.name} (${formatAmount(denthieSaved(group, actor.id))}) : « ${text} ».`,
  );
  recordAudit(
    actor,
    'withdrawal_requested',
    `a demandé un retrait d’urgence — ${group.name}`,
    group.id,
  );
}

export function withdraw(group: Group, actor: User, userId: string, reason: string): void {
  assertDenthie(group);
  if (group.status !== 'active') {
    throw new ServiceError('Le retrait d’urgence concerne un Denthie en cours.');
  }
  if (distributionOf(group)) {
    throw new ServiceError('La répartition est lancée : chacun recevra sa part.');
  }
  const memberships = activeMemberships(group.id).filter((m) => m.userId === userId);
  if (memberships.length === 0) {
    throw new ServiceError('Cette personne ne fait pas partie du Denthie.');
  }
  const text = cleanReason(reason, 'Indiquez la raison du retrait d’urgence.');
  const saved = denthieSaved(group, userId);
  if (saved >= APPROVAL_THRESHOLD && !isSuperAdmin(actor)) {
    throw new ServiceError(
      `Retrait de ${formatAmount(APPROVAL_THRESHOLD)} ou plus : il doit être accordé par le super administrateur.`,
      'forbidden',
    );
  }
  assertPayoutPhones(group, [userId]);
  let sent = 0;
  let kept = 0;
  if (saved > 0) {
    const round: Round = {
      id: newId('r'),
      groupId: group.id,
      number: nextNumber(group),
      openDate: nowIso(),
      dueDate: nowIso(),
      beneficiaryId: userId,
      recipientType: 'members',
      purpose: 'withdrawal',
      potAmount: saved,
      status: 'paid_out',
      paidOutAt: nowIso(),
      payoutValidatedBy: actor.id,
      cycle: group.currentCycle,
    };
    db.rounds.push(round);
    fillPayout(group, round, [userId]);
    kept = withholdDebts(group, round)[userId] ?? 0;
    sent = round.beneficiaryAmounts?.[userId] ?? 0;
  }
  for (const membership of memberships) {
    membership.status = 'removed';
    membership.payoutOrder = undefined;
  }
  for (const period of periods(group)) {
    if (period.status === 'open' || period.status === 'ready_for_payout') {
      period.potAmount = group.contributionAmount * activeMemberships(group.id).length;
    }
  }
  const person = db.users.find((u) => u.id === userId);
  notify(
    userId,
    'payout',
    'Retrait d’urgence accordé',
    saved > 0
      ? `${group.name} : votre épargne de ${formatAmount(sent)} va vous être envoyée${kept > 0 ? ` (${formatAmount(kept)} retenus pour vos pénalités)` : ''}. Vous ne cotisez plus dans ce Denthie.`
      : `${group.name} : vous quittez le Denthie (aucune épargne à vous rendre).`,
    '/groupes',
  );
  if (saved > 0) {
    notifyManagers(
      group.id,
      'denthie_withdrawal',
      'Retrait d’urgence à envoyer',
      `${group.name} : envoyez ${formatAmount(sent)} à ${person ? fullName(person) : 'ce membre'} (Tours → Cagnottes à envoyer).`,
    );
  }
  recordAudit(
    actor,
    'denthie_withdrawal',
    `a accordé un retrait d’urgence de ${formatAmount(sent)} à ${person ? fullName(person) : 'un membre'} (« ${text} ») — ${group.name}`,
    group.id,
  );
}
