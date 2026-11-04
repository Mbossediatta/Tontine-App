// Construction des vues renvoyées par les services simulés.
import { computePot } from '@/lib/tontine';
import type { Group, GroupOverview, MemberView, PublicUser, User } from '@/types';
import { activeMemberships, canManage, membershipOf } from './access';
import { db, requireUser } from './db';
import { hasPaidMembershipFee } from './revenue';
import {
  amountDue,
  currentRoundOf,
  cycleRounds,
  memberStatus,
  paidCount,
  penaltyFor,
} from './lifecycle';
import { roundCollected } from './metrics';

export function toPublicUser(user: User, withPhone: boolean): PublicUser {
  if (user.deletedAt) {
    return { id: user.id, firstName: 'Compte', lastName: 'supprimé' };
  }
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    avatarUrl: user.avatarUrl,
    phone: withPhone ? user.phone : undefined,
    payoutPhone: withPhone ? user.payoutPhone : undefined,
    payoutMethod: withPhone ? user.payoutMethod : undefined,
  };
}

export function buildOverview(group: Group, viewer: User): GroupOverview {
  const membership = membershipOf(group.id, viewer.id);
  const members = activeMemberships(group.id);
  const memberCount = new Set(members.map((item) => item.userId)).size;
  const rounds = cycleRounds(group);
  const current = currentRoundOf(group.id);
  const isActiveMember = membership?.status === 'active';
  const myStatus = current && isActiveMember ? memberStatus(current, viewer.id) : undefined;
  const penalty = current && isActiveMember ? penaltyFor(current.id, viewer.id) : 0;
  const canManageGroup = canManage(group, viewer);
  const totalCollected = rounds
    .filter((round) => canManageGroup || round.recipientType !== 'platform')
    .reduce((sum, round) => sum + roundCollected(round), 0);
  const myMembershipIds = new Set(
    members.filter((item) => item.userId === viewer.id).map((item) => item.id),
  );
  const myTurn = rounds.find(
    (round) =>
      round.status !== 'paid_out' &&
      round.recipientType !== 'platform' &&
      (round.beneficiaryMembershipIds?.some((id) => myMembershipIds.has(id)) ??
        round.beneficiaryId === viewer.id),
  );
  const myTurnForUser = myTurn
    ? (() => {
        const recipients = members.filter((item) =>
          myTurn.beneficiaryMembershipIds
            ? myTurn.beneficiaryMembershipIds.includes(item.id)
            : item.userId === myTurn.beneficiaryId,
        );
        const shareValue = Math.floor(myTurn.potAmount / Math.max(1, recipients.length));
        const remainder = myTurn.potAmount - shareValue * recipients.length;
        const order = myTurn.beneficiaryMembershipIds ?? recipients.map((item) => item.id);
        const amount = recipients
          .filter((item) => item.userId === viewer.id)
          .reduce((sum, item) => {
            const index = order.indexOf(item.id);
            return sum + shareValue + (index >= 0 && index < remainder ? 1 : 0);
          }, 0);
        return { ...myTurn, potAmount: amount };
      })()
    : undefined;
  const currentBeneficiaries =
    current && current.recipientType !== 'platform'
      ? [
          ...new Map(
            members
              .filter((item) => current.beneficiaryMembershipIds?.includes(item.id))
              .map((item) => [
                item.userId,
                toPublicUser(requireUser(item.userId), canManage(group, viewer)),
              ]),
          ).values(),
        ]
      : [];
  const nextPot = group.dailyContribution
    ? group.contributionAmount * (group.turnDurationDays ?? 10) * group.maxMembers
    : computePot(group.contributionAmount, group.maxMembers);

  const admin = db.users.find((u) => u.id === group.adminId);
  const community = db.communities.find((item) => item.id === group.communityId);
  return {
    group,
    communityName: community?.name,
    adminName: admin ? `${admin.firstName} ${admin.lastName}` : '—',
    canManage: canManageGroup,
    myRole: membership?.role,
    myMembershipStatus: membership?.status,
    activeMemberCount: memberCount,
    activeShareCount: members.length,
    pendingRequestCount: db.memberships.filter(
      (m) => m.groupId === group.id && m.status === 'pending',
    ).length,
    potAmount:
      current?.recipientType === 'platform' && !canManage(group, viewer)
        ? 0
        : (current?.potAmount ?? nextPot),
    totalRounds:
      rounds.length ||
      Math.ceil(group.maxMembers / Math.max(1, group.sharesPerRound ?? 1)) +
        (group.reserveFinalTurn ? 1 : 0),
    currentRound:
      current?.recipientType === 'platform' && !canManage(group, viewer)
        ? { ...current, potAmount: 0 }
        : current,
    currentBeneficiary:
      currentBeneficiaries[0] ??
      (current && current.recipientType !== 'platform'
        ? toPublicUser(requireUser(current.beneficiaryId), canManage(group, viewer))
        : undefined),
    currentBeneficiaries,
    paidCount: current ? paidCount(current) : 0,
    totalCollected,
    myStatus,
    myAmountDue:
      myStatus && myStatus !== 'paid' && current ? amountDue(group, current, viewer.id) : 0,
    myMembershipFeeDue:
      isActiveMember && !hasPaidMembershipFee(group.id, viewer.id)
        ? (group.membershipFeeAmount ?? 0)
        : 0,
    myPenalty: penalty,
    myTurn: myTurnForUser,
    orderIsSet: members.length > 0 && members.every((m) => typeof m.payoutOrder === 'number'),
  };
}

export function buildMemberViews(group: Group, viewer: User): MemberView[] {
  const manager = canManage(group, viewer);
  // Règle du groupe : statuts réservés aux administrateurs, ou visibles de tous les membres.
  const showStatuses = manager || group.memberStatusVisibility !== 'admins';
  const current = currentRoundOf(group.id);
  const memberships = db.memberships
    .filter(
      (m) =>
        m.groupId === group.id && (m.status === 'active' || (manager && m.status === 'pending')),
    )
    .sort((a, b) => (a.payoutOrder ?? 999) - (b.payoutOrder ?? 999));
  const shareCounts = new Map<string, number>();
  for (const membership of memberships) {
    if (membership.status === 'active') {
      shareCounts.set(membership.userId, (shareCounts.get(membership.userId) ?? 0) + 1);
    }
  }
  const shareNumbers = new Map<string, number>();
  const seenShares = new Map<string, number>();
  for (const membership of memberships) {
    if (membership.status !== 'active') continue;
    const number = (seenShares.get(membership.userId) ?? 0) + 1;
    seenShares.set(membership.userId, number);
    shareNumbers.set(membership.id, number);
  }
  return memberships.map((membership) => ({
    membership,
    user: toPublicUser(requireUser(membership.userId), manager),
    shareNumber: shareNumbers.get(membership.id) ?? 1,
    shareCount: shareCounts.get(membership.userId) ?? 1,
    currentStatus:
      showStatuses && current && membership.status === 'active'
        ? memberStatus(current, membership.userId)
        : undefined,
  }));
}
