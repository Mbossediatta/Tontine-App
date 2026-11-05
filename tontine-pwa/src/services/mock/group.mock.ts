import { startOfDay } from 'date-fns';
import { ServiceError } from '@/lib/errors';
import { formatAmount, fullName } from '@/lib/format';
import type { Group } from '@/types';
import type { GroupService } from '../group.service';
import {
  activeMemberships,
  assertCanManage,
  assertCanView,
  assertOwner,
  assertAdmin,
  canManage,
  isSuperAdmin,
  membershipOf,
  requireGroup,
} from './access';
import {
  currentUser,
  db,
  delay,
  generateInviteCode,
  newId,
  nowIso,
  persist,
  requireOnline,
  requireUser,
} from './db';
import { recordAudit } from './audit';
import { synchronize } from './clock';
import { createRounds, notify, notifyManagers } from './lifecycle';
import { inspectInput } from './security';
import { buildOverview } from './views';

function findByCode(code: string): Group {
  const group = db.groups.find((g) => g.inviteCode === code.trim().toUpperCase());
  if (!group) throw new ServiceError('Code d’invitation inconnu.', 'not_found');
  return group;
}

/** Administrateur actif à qui confier un groupe (choix obligatoire du super administrateur). */
function requireActiveAdmin(adminId: string | undefined) {
  const admin = adminId ? db.users.find((u) => u.id === adminId) : undefined;
  if (!admin || admin.globalRole !== 'admin' || admin.isSuspended || admin.deletedAt) {
    throw new ServiceError('Choisissez l’administrateur responsable du groupe.');
  }
  return admin.id;
}

/** Vérifie montant et nombre de parts contre les limites fixées par le super administrateur. */
function assertWithinLimits(input: {
  contributionAmount?: number;
  maxMembers?: number;
  sharesPerRound?: number;
}) {
  const { minContribution, maxContribution, maxMembers } = db.settings.rules;
  const amount = input.contributionAmount;
  if (amount !== undefined && (amount < minContribution || amount > maxContribution)) {
    throw new ServiceError(
      `La cotisation doit être comprise entre ${formatAmount(minContribution)} et ${formatAmount(maxContribution)}.`,
    );
  }
  if (input.maxMembers !== undefined && input.maxMembers > maxMembers) {
    throw new ServiceError(`Un groupe ne peut pas dépasser ${maxMembers} parts.`);
  }
  if (
    'sharesPerRound' in input &&
    input.sharesPerRound !== undefined &&
    input.maxMembers !== undefined &&
    input.sharesPerRound > input.maxMembers
  ) {
    throw new ServiceError(
      'Les parts payées par tour ne peuvent pas dépasser les parts du groupe.',
    );
  }
}

export const mockGroupService: GroupService = {
  async listMine() {
    await delay();
    synchronize();
    const user = currentUser();
    return db.groups.filter((g) => membershipOf(g.id, user.id)).map((g) => buildOverview(g, user));
  },

  async listDiscoverable() {
    await delay();
    const user = currentUser();
    if (user.globalRole !== 'user') return [];
    const communityIds = new Set(
      db.memberships
        .filter((membership) => membership.userId === user.id && membership.status === 'active')
        .flatMap((membership) => {
          const group = db.groups.find((item) => item.id === membership.groupId);
          return group?.communityId ? [group.communityId] : [];
        }),
    );
    return db.groups
      .filter(
        (group) =>
          group.joinPolicy === 'community' &&
          group.status === 'draft' &&
          !group.archivedAt &&
          group.communityId !== undefined &&
          communityIds.has(group.communityId) &&
          !membershipOf(group.id, user.id) &&
          activeMemberships(group.id).length < group.maxMembers,
      )
      .map((group) => buildOverview(group, user));
  },

  async listManaged() {
    await delay();
    synchronize();
    const user = currentUser();
    return db.groups.filter((g) => canManage(g, user)).map((g) => buildOverview(g, user));
  },

  async get(groupId) {
    await delay();
    synchronize();
    const user = currentUser();
    const group = requireGroup(groupId);
    assertCanView(group, user);
    return buildOverview(group, user);
  },

  async create(input) {
    requireOnline();
    await delay();
    const user = currentUser();
    assertAdmin(user);
    // Super administrateur : il confie le groupe à un admin et n'y cotise pas.
    // Administrateur : il gère son groupe et en est le premier membre (propriétaire),
    // ou bien il le confie à un autre admin, qui le gère seul.
    assertWithinLimits(input);
    inspectInput('Nom du groupe', input.name, user.id);
    inspectInput('Description du groupe', input.description, user.id);
    const byPlatform = isSuperAdmin(user);
    const delegated = !byPlatform && !!input.adminId && input.adminId !== user.id;
    const adminId = byPlatform || delegated ? requireActiveAdmin(input.adminId) : user.id;
    const community =
      (input.communityId
        ? db.communities.find((item) => item.id === input.communityId)
        : db.communities.find((item) => item.adminIds.includes(adminId))) ?? undefined;
    if (!community) {
      throw new ServiceError('Affectez d’abord votre compte à une communauté.');
    }
    // L'admin du groupe n'a pas à être admin de la communauté : on peut confier le
    // groupe à n'importe quel admin actif. Un admin, lui, ne crée des groupes que
    // dans les communautés qui lui sont affectées.
    if (!byPlatform && !community.adminIds.includes(user.id)) {
      throw new ServiceError('Vous n’êtes pas administrateur de cette communauté.');
    }
    const { collectMembershipFee, ...groupInput } = input;
    const group: Group = {
      // `adminId` (plus bas) remplace celui saisi : seul le choix vérifié compte.
      ...groupInput,
      id: newId('g'),
      communityId: community.id,
      joinPolicy: input.joinPolicy ?? 'invite',
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      turnLength: input.turnLength,
      sharesPerRound: input.sharesPerRound ?? 1,
      membershipFeeAmount: collectMembershipFee ? (input.membershipFeeAmount ?? 0) : 0,
      reserveFinalTurn: input.reserveFinalTurn ?? true,
      status: 'draft',
      inviteCode: generateInviteCode(),
      createdBy: user.id,
      adminId,
      currentCycle: 1,
    };
    db.groups.push(group);
    if (byPlatform || delegated) {
      notify(
        adminId,
        'admin',
        'Nouveau groupe à gérer',
        `${byPlatform ? 'Le super administrateur' : fullName(user)} vous a confié « ${group.name} ».`,
        `/admin/groupes/${group.id}`,
      );
    } else {
      // Le créateur est propriétaire et participe à la tontine.
      db.memberships.push({
        id: newId('m'),
        groupId: group.id,
        userId: user.id,
        role: 'owner',
        status: 'active',
        joinedAt: nowIso(),
      });
    }
    recordAudit(user, 'group_created', `a créé le groupe « ${group.name} »`, group.id);
    persist();
    return group;
  },

  async update(groupId, input) {
    requireOnline();
    await delay();
    const user = currentUser();
    const group = requireGroup(groupId);
    assertCanManage(group, user);
    assertWithinLimits(input);
    inspectInput('Nom du groupe', input.name, user.id);
    inspectInput('Description du groupe', input.description, user.id);
    if (
      input.sharesPerRound !== undefined &&
      input.sharesPerRound > (input.maxMembers ?? group.maxMembers)
    ) {
      throw new ServiceError(
        'Les parts payées par tour ne peuvent pas dépasser les parts du groupe.',
      );
    }
    const locked =
      group.status !== 'draft' &&
      ((
        [
          'contributionAmount',
          'frequency',
          'maxMembers',
          'turnLength',
          'sharesPerRound',
          'membershipFeeAmount',
          'reserveFinalTurn',
        ] as const
      ).some((key) => input[key] !== undefined && input[key] !== group[key]) ||
        (input.collectMembershipFee !== undefined &&
          input.collectMembershipFee !== (group.membershipFeeAmount ?? 0) > 0));
    if (locked) {
      throw new ServiceError(
        'Les règles financières et le nombre total de parts sont verrouillés après le démarrage.',
      );
    }
    if (input.maxMembers !== undefined && input.maxMembers < activeMemberships(groupId).length) {
      throw new ServiceError('Le groupe compte déjà plus de parts que ce nombre.');
    }
    // Le journal garde la trace du changement de montant, le plus sensible.
    const amountChanged =
      input.contributionAmount !== undefined &&
      input.contributionAmount !== group.contributionAmount;
    const { collectMembershipFee, ...changes } = input;
    if (collectMembershipFee !== undefined) {
      changes.membershipFeeAmount = collectMembershipFee
        ? (input.membershipFeeAmount ?? group.membershipFeeAmount ?? 0)
        : 0;
    }
    Object.assign(group, changes);
    recordAudit(
      user,
      'group_updated',
      amountChanged
        ? `a modifié le montant de cotisation de « ${group.name} » (${formatAmount(group.contributionAmount)})`
        : `a modifié les réglages de « ${group.name} »`,
      group.id,
    );
    persist();
    return { ...group };
  },

  async start(groupId) {
    requireOnline();
    await delay();
    const user = currentUser();
    const group = requireGroup(groupId);
    assertCanManage(group, user);
    const members = activeMemberships(groupId);
    if (group.status !== 'draft') throw new ServiceError('Le cycle a déjà démarré.');
    if (new Set(members.map((membership) => membership.userId)).size < 2) {
      throw new ServiceError('Un groupe doit avoir au moins deux personnes distinctes.');
    }
    if (members.length !== group.maxMembers) {
      throw new ServiceError(
        'Toutes les parts doivent être attribuées avant de démarrer le groupe.',
      );
    }
    if (members.some((m) => m.payoutOrder === undefined)) {
      throw new ServiceError('Fixez d’abord l’ordre des bénéficiaires.');
    }
    if (new Date(group.startDate) < startOfDay(new Date())) {
      throw new ServiceError(
        'La date de démarrage est passée : choisissez-en une nouvelle dans les réglages.',
      );
    }
    group.status = 'active';
    createRounds(group);
    persist();
    return { ...group };
  },

  async remove(groupId) {
    requireOnline();
    await delay();
    const user = currentUser();
    const group = requireGroup(groupId);
    assertOwner(group, user);
    if (group.status !== 'draft') {
      throw new ServiceError('Seul un groupe en brouillon peut être supprimé.');
    }
    if (group.currentCycle > 1) {
      throw new ServiceError(
        'Ce groupe a un historique de paiements : il ne peut pas être supprimé.',
      );
    }
    db.groups = db.groups.filter((g) => g.id !== groupId);
    db.memberships = db.memberships.filter((m) => m.groupId !== groupId);
    persist();
  },

  async restartCycle(groupId, { startDate, keepOrder }) {
    requireOnline();
    await delay();
    const user = currentUser();
    const group = requireGroup(groupId);
    assertCanManage(group, user);
    if (group.status !== 'finished') {
      throw new ServiceError('Seul un groupe terminé peut repartir pour un nouveau cycle.');
    }
    if (Number.isNaN(Date.parse(startDate))) throw new ServiceError('Date de démarrage invalide.');
    group.currentCycle += 1;
    group.status = 'draft';
    group.startDate = startDate;
    const members = activeMemberships(groupId);
    if (!keepOrder) members.forEach((m) => (m.payoutOrder = undefined));
    const notified = new Set<string>();
    for (const membership of members) {
      if (notified.has(membership.userId)) continue;
      notified.add(membership.userId);
      notify(
        membership.userId,
        'new_cycle',
        'Nouveau cycle',
        `${group.name} repart pour un cycle ${group.currentCycle}.`,
        `/groupes/${group.id}`,
      );
    }
    persist();
    return { ...group };
  },

  async regenerateInviteCode(groupId) {
    requireOnline();
    await delay();
    const group = requireGroup(groupId);
    assertCanManage(group, currentUser());
    group.inviteCode = generateInviteCode();
    persist();
    return group.inviteCode;
  },

  async getByInviteCode(code) {
    await delay();
    const user = currentUser();
    const group = findByCode(code);
    const members = activeMemberships(group.id);
    const uniqueAdmins = new Map(
      members
        .filter((m) => m.role === 'owner' || m.role === 'co_admin')
        .map((m) => [m.userId, fullName(requireUser(m.userId))]),
    );
    return {
      group,
      communityName: db.communities.find((item) => item.id === group.communityId)?.name,
      activeMemberCount: new Set(members.map((member) => member.userId)).size,
      activeShareCount: members.length,
      placesLeft: Math.max(0, group.maxMembers - members.length),
      adminNames: [...uniqueAdmins.values()],
      myMembershipStatus: membershipOf(group.id, user.id)?.status,
    };
  },

  async requestJoin(code) {
    requireOnline();
    await delay();
    const user = currentUser();
    const group = findByCode(code);
    if (membershipOf(group.id, user.id))
      throw new ServiceError('Vous avez déjà rejoint ce groupe.');
    if (group.status !== 'draft') throw new ServiceError('Ce groupe a déjà démarré.');
    if (activeMemberships(group.id).length >= group.maxMembers && !isSuperAdmin(user)) {
      throw new ServiceError('Toutes les parts configurées pour ce groupe sont attribuées.');
    }
    db.memberships.push({
      id: newId('m'),
      groupId: group.id,
      userId: user.id,
      role: 'member',
      status: 'pending',
      joinedAt: nowIso(),
    });
    notifyManagers(
      group.id,
      'join_request',
      'Nouvelle demande d’adhésion',
      `${fullName(user)} souhaite rejoindre ${group.name}.`,
    );
    persist();
  },

  async requestJoinOpen(groupId) {
    requireOnline();
    await delay();
    const user = currentUser();
    const group = requireGroup(groupId);
    if (user.globalRole !== 'user') {
      throw new ServiceError('La découverte est réservée aux participants.');
    }
    if (group.joinPolicy !== 'community' || !group.communityId) {
      throw new ServiceError('Ce groupe est privé : utilisez son code d’invitation.');
    }
    const hasCommunityMembership = db.memberships.some((membership) => {
      if (membership.userId !== user.id || membership.status !== 'active') return false;
      return db.groups.some(
        (memberGroup) =>
          memberGroup.id === membership.groupId && memberGroup.communityId === group.communityId,
      );
    });
    if (!hasCommunityMembership) {
      throw new ServiceError('Ce groupe est réservé aux membres de sa communauté.', 'forbidden');
    }
    if (membershipOf(group.id, user.id)) {
      throw new ServiceError('Vous avez déjà rejoint ce groupe.');
    }
    if (group.status !== 'draft') {
      throw new ServiceError('Ce groupe a déjà démarré et n’accepte plus de membres.');
    }
    if (activeMemberships(group.id).length >= group.maxMembers) {
      throw new ServiceError('Toutes les parts configurées pour ce groupe sont attribuées.');
    }
    db.memberships.push({
      id: newId('m'),
      groupId: group.id,
      userId: user.id,
      role: 'member',
      status: 'pending',
      joinedAt: nowIso(),
    });
    notifyManagers(
      group.id,
      'join_request',
      'Nouvelle demande d’adhésion',
      `${fullName(user)} souhaite rejoindre ${group.name}.`,
    );
    persist();
  },

  async announce(groupId, message) {
    requireOnline();
    await delay();
    const user = currentUser();
    const group = requireGroup(groupId);
    assertCanManage(group, user);
    const text = message.trim();
    if (!text) throw new ServiceError('Écrivez un message avant d’envoyer.');
    // Chaque membre actif (sauf l'auteur) reçoit l'annonce comme notification.
    const recipients = new Set(
      activeMemberships(group.id)
        .filter((m) => m.userId !== user.id)
        .map((membership) => membership.userId),
    );
    for (const userId of recipients) {
      notify(userId, 'announcement', `Annonce · ${group.name}`, text, `/groupes/${group.id}`);
    }
    persist();
    return recipients.size;
  },
};
