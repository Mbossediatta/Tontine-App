// Règles d'accès appliquées par les services simulés (le futur backend les appliquera aussi).
import { ServiceError } from '@/lib/errors';
import type { Group, Membership, Round, User } from '@/types';
import { db } from './db';
import { recordSecurityEvent } from './security';

/** Refus d'accès : noté dans le journal de sécurité, puis l'erreur est levée. */
function deny(user: User, message: string, detail: string): never {
  recordSecurityEvent('access_denied', detail, { userId: user.id });
  throw new ServiceError(message, 'forbidden');
}

export function isSuperAdmin(user: User): boolean {
  return user.globalRole === 'super_admin';
}

export function requireGroup(groupId: string): Group {
  const group = db.groups.find((item) => item.id === groupId);
  if (!group) throw new ServiceError('Ce groupe n’existe pas.', 'not_found');
  return group;
}

export function requireRound(roundId: string): Round {
  const round = db.rounds.find((item) => item.id === roundId);
  if (!round) throw new ServiceError('Ce tour n’existe pas.', 'not_found');
  return round;
}

export function requireMembership(membershipId: string): Membership {
  const membership = db.memberships.find((item) => item.id === membershipId);
  if (!membership) throw new ServiceError('Ce membre n’existe pas.', 'not_found');
  return membership;
}

export function membershipOf(groupId: string, userId: string): Membership | undefined {
  return (
    db.memberships.find(
      (item) => item.groupId === groupId && item.userId === userId && item.status === 'active',
    ) ??
    db.memberships.find(
      (item) => item.groupId === groupId && item.userId === userId && item.status !== 'removed',
    )
  );
}

export function activeMemberships(groupId: string): Membership[] {
  return db.memberships
    .filter((item) => item.groupId === groupId && item.status === 'active')
    .sort((a, b) => (a.payoutOrder ?? 999) - (b.payoutOrder ?? 999));
}

/**
 * Peut gérer le groupe : le super administrateur, l'administrateur responsable
 * (`adminId`, même s'il n'y cotise pas), et les propriétaire / co-admins membres.
 * Être administrateur de la communauté ne donne pas automatiquement accès à
 * l'administration de chacun de ses groupes.
 */
export function canManage(group: Group, user: User): boolean {
  if (isSuperAdmin(user)) return true;
  if (group.adminId === user.id) return true;
  const membership = membershipOf(group.id, user.id);
  return (
    membership?.status === 'active' &&
    (membership.role === 'owner' || membership.role === 'co_admin')
  );
}

export function canView(group: Group, user: User): boolean {
  return canManage(group, user) || membershipOf(group.id, user.id)?.status === 'active';
}

export function assertCanView(group: Group, user: User): void {
  if (!canView(group, user)) {
    deny(
      user,
      'Vous ne faites pas partie de ce groupe.',
      `Accès refusé au groupe « ${group.name} » (non membre)`,
    );
  }
}

export function assertCanManage(group: Group, user: User): void {
  if (!canManage(group, user)) {
    deny(
      user,
      'Seuls les administrateurs du groupe peuvent faire cela.',
      `Action d’administration refusée sur « ${group.name} »`,
    );
  }
}

export function assertOwner(group: Group, user: User): void {
  const membership = membershipOf(group.id, user.id);
  // L'admin responsable a les mêmes droits que le propriétaire.
  if (!isSuperAdmin(user) && group.adminId !== user.id && membership?.role !== 'owner') {
    throw new ServiceError('Seul le propriétaire du groupe peut faire cela.', 'forbidden');
  }
}

export function assertSuperAdmin(user: User): void {
  if (!isSuperAdmin(user)) {
    deny(
      user,
      'Réservé au super administrateur.',
      'Accès refusé à une fonction du super administrateur',
    );
  }
}

export function assertAdmin(user: User): void {
  if (user.globalRole !== 'admin' && !isSuperAdmin(user)) {
    throw new ServiceError('Réservé aux administrateurs.', 'forbidden');
  }
}
