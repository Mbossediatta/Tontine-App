// Calculs à l'échelle de la plateforme, partagés par le tableau de bord du super
// administrateur, la gestion des administrateurs et la fiche des membres.
import { ServiceError } from '@/lib/errors';
import { fullName } from '@/lib/format';
import type { AdminPerformance, Group, Round, TransactionRow, User } from '@/types';
import { activeMemberships } from './access';
import { db, findUser } from './db';
import { amountDue, currentRoundOf, memberStatus } from './lifecycle';
import { recoveryRate, sumCollection } from './metrics';
import { needsPin } from './pin';
import { toPublicUser } from './views';

/** Refuse un paiement ou un versement dans un groupe suspendu ou clôturé. */
export function assertGroupOpen(group: Group): void {
  if (group.status === 'suspended') {
    throw new ServiceError('Ce groupe est suspendu par l’administration de la plateforme.');
  }
  if (group.status === 'finished') throw new ServiceError('Ce groupe est clôturé.');
}

/** Membres en retard sur un tour, avec la somme que chacun doit (cotisation + pénalité). */
export function lateOnRound(group: Group, round: Round, now: Date = new Date()) {
  const users = new Set(activeMemberships(group.id).map((membership) => membership.userId));
  return [...users]
    .filter((userId) => memberStatus(round, userId, now) === 'late')
    .map((userId) => ({ userId, amount: amountDue(group, round, userId) }));
}

/** Cotisations en retard d'un membre (tour en cours de chacun de ses groupes actifs). */
export function latesOf(userId: string, now: Date = new Date()) {
  return db.groups
    .filter((g) => g.status === 'active')
    .flatMap((group) => {
      const round = currentRoundOf(group.id);
      const late = round ? lateOnRound(group, round, now).find((l) => l.userId === userId) : null;
      return round && late
        ? [
            {
              groupId: group.id,
              groupName: group.name,
              roundNumber: round.number,
              amount: late.amount,
            },
          ]
        : [];
    });
}

/**
 * Groupes gérés par un administrateur : ceux dont il est responsable (`adminId`)
 * ou où il est propriétaire ou co-administrateur. Une affectation à la communauté
 * seule ne confère pas de droits sur les groupes qui y sont rattachés.
 */
export function groupsManagedBy(user: User): Group[] {
  const viaMembership = new Set(
    db.memberships
      .filter(
        (m) =>
          m.userId === user.id &&
          m.status === 'active' &&
          (m.role === 'owner' || m.role === 'co_admin'),
      )
      .map((m) => m.groupId),
  );
  return db.groups.filter(
    (g) => g.adminId === user.id || viaMembership.has(g.id),
  );
}

/** Nom de l'administrateur responsable d'un groupe. */
export function adminNameOf(group: Group): string {
  const admin = findUser(group.adminId);
  return admin ? fullName(admin) : '—';
}

/** Groupes, membres et taux de recouvrement d'un administrateur. */
export function adminPerformance(user: User, now: Date = new Date()): AdminPerformance {
  const groups = groupsManagedBy(user);
  const groupIds = new Set(groups.map((g) => g.id));
  const memberIds = new Set(groups.flatMap((g) => activeMemberships(g.id).map((m) => m.userId)));
  memberIds.delete(user.id);
  // Seuls les tours échus comptent : un tour en cours n'est pas encore « en défaut ».
  const dueRounds = db.rounds.filter(
    (r) => groupIds.has(r.groupId) && r.status !== 'upcoming' && new Date(r.dueDate) < now,
  );
  return {
    user,
    groups: groups.map(({ id, name, status }) => ({ id, name, status })),
    memberCount: memberIds.size,
    recoveryRate: recoveryRate(sumCollection(dueRounds)),
    pinPending: needsPin(user.id),
  };
}

/** Date à retenir pour trier une transaction : lancement, sinon encaissement. */
function transactionDate(payment: { createdAt?: string; paidAt?: string }): number {
  const iso = payment.createdAt ?? payment.paidAt;
  return iso ? new Date(iso).getTime() : 0;
}

/** Transactions de la plateforme (ou d'un seul membre), de la plus récente à la plus ancienne. */
export function allTransactions(userId?: string): TransactionRow[] {
  const rounds = new Map(db.rounds.map((r) => [r.id, r]));
  const groups = new Map(db.groups.map((g) => [g.id, g]));
  return db.payments
    .filter((p) => !userId || p.userId === userId)
    .sort((a, b) => transactionDate(b) - transactionDate(a))
    .flatMap((payment) => {
      const round = rounds.get(payment.roundId);
      const group = round ? groups.get(round.groupId) : undefined;
      const user = findUser(payment.userId);
      if (!round || !group || !user) return [];
      return [
        {
          payment,
          user: toPublicUser(user, true),
          groupId: group.id,
          groupName: group.name,
          roundNumber: round.number,
        },
      ];
    });
}
