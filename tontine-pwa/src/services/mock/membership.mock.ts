import { ServiceError } from '@/lib/errors';
import type { MembershipService } from '../membership.service';
import {
  activeMemberships,
  assertCanManage,
  assertCanView,
  assertOwner,
  canManage,
  membershipOf,
  requireGroup,
  requireMembership,
} from './access';
import { currentUser, db, delay, newId, nowIso, persist, requireOnline } from './db';
import { notify } from './lifecycle';
import { buildMemberViews } from './views';

function assertHasRoom(groupId: string, maxShares: number, additionalShares = 1) {
  if (activeMemberships(groupId).length + additionalShares > maxShares) {
    throw new ServiceError('Toutes les parts configurées pour ce groupe sont attribuées.');
  }
}

export const mockMembershipService: MembershipService = {
  async list(groupId) {
    await delay();
    const user = currentUser();
    const group = requireGroup(groupId);
    assertCanView(group, user);
    const views = buildMemberViews(group, user);
    if (canManage(group, user)) return views;
    // Calendrier confidentiel : le rang des autres (donc leur tour) n'est pas transmis.
    return views.map((view) =>
      view.user.id === user.id
        ? view
        : { ...view, membership: { ...view.membership, payoutOrder: undefined } },
    );
  },

  async accept(membershipId) {
    requireOnline();
    await delay();
    const membership = requireMembership(membershipId);
    const group = requireGroup(membership.groupId);
    assertCanManage(group, currentUser());
    if (membership.status !== 'pending') throw new ServiceError('Demande déjà traitée.');
    assertHasRoom(group.id, group.maxMembers);
    membership.status = 'active';
    membership.joinedAt = nowIso();
    notify(
      membership.userId,
      'join_accepted',
      'Demande acceptée',
      `Bienvenue dans ${group.name} !`,
      `/groupes/${group.id}`,
    );
    persist();
  },

  async reject(membershipId) {
    requireOnline();
    await delay();
    const membership = requireMembership(membershipId);
    const group = requireGroup(membership.groupId);
    assertCanManage(group, currentUser());
    membership.status = 'removed';
    notify(
      membership.userId,
      'join_rejected',
      'Demande refusée',
      `${group.name} : demande refusée.`,
    );
    persist();
  },

  async remove(membershipId) {
    requireOnline();
    await delay();
    const membership = requireMembership(membershipId);
    const group = requireGroup(membership.groupId);
    assertCanManage(group, currentUser());
    if (group.status !== 'draft') {
      throw new ServiceError('Impossible de retirer un membre après le démarrage du cycle.');
    }
    if (membership.role === 'owner')
      throw new ServiceError('Le propriétaire ne peut pas être retiré.');
    if (membership.role === 'co_admin') assertOwner(group, currentUser());
    membership.status = 'removed';
    membership.payoutOrder = undefined;
    persist();
  },

  async setRole(membershipId, role) {
    requireOnline();
    await delay();
    const membership = requireMembership(membershipId);
    const group = requireGroup(membership.groupId);
    const user = currentUser();
    assertCanManage(group, user);
    if (membership.role === 'owner') throw new ServiceError('Le rôle du propriétaire est fixe.');
    if (membership.status !== 'active') throw new ServiceError('Ce membre n’est pas actif.');
    if (role === 'member') assertOwner(group, user);
    membership.role = role;
    if (role === 'co_admin') {
      notify(
        membership.userId,
        'co_admin',
        'Vous êtes co-administrateur',
        `Vous pouvez maintenant gérer ${group.name}.`,
        `/admin/groupes/${group.id}`,
      );
    }
    persist();
  },

  async addByPhone(groupId, phone, shareCount = 1) {
    requireOnline();
    await delay();
    const group = requireGroup(groupId);
    assertCanManage(group, currentUser());
    if (group.status !== 'draft') throw new ServiceError('Le cycle a déjà démarré.');
    if (!Number.isInteger(shareCount) || shareCount < 1 || shareCount > group.maxMembers) {
      throw new ServiceError(
        'Le nombre de parts doit être compris entre 1 et la capacité du groupe.',
      );
    }
    const target = db.users.find((u) => u.phone === phone);
    if (!target) {
      throw new ServiceError(
        'Aucun compte avec ce numéro. Partagez le lien d’invitation pour qu’il s’inscrive.',
        'not_found',
      );
    }
    const existing = membershipOf(groupId, target.id);
    const alreadyActive = existing?.status === 'active';
    const pendingJoin = existing?.status === 'pending' ? existing : undefined;
    const sharesToCreate = alreadyActive
      ? shareCount
      : Math.max(0, shareCount - (pendingJoin ? 1 : 0));
    const sharesToActivate = pendingJoin ? 1 : 0;
    assertHasRoom(groupId, group.maxMembers, sharesToCreate + sharesToActivate);
    if (pendingJoin) {
      pendingJoin.status = 'active';
    }
    for (let index = 0; index < sharesToCreate; index += 1) {
      db.memberships.push({
        id: newId('m'),
        groupId,
        userId: target.id,
        role: 'member',
        status: 'active',
        joinedAt: nowIso(),
      });
    }
    notify(
      target.id,
      'added',
      alreadyActive ? 'Parts supplémentaires ajoutées' : 'Ajouté à un groupe',
      alreadyActive
        ? `${shareCount} part(s) supplémentaire(s) vous ont été attribuée(s) dans ${group.name}.`
        : `Vous faites partie de ${group.name} avec ${shareCount} part(s).`,
      `/groupes/${groupId}`,
    );
    persist();
    return shareCount;
  },
};
