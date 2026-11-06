import { ServiceError } from '@/lib/errors';
import { formatDate, fullName } from '@/lib/format';
import type { Group, Round, SwapRequest } from '@/types';
import type { SwapService } from '../swap.service';
import {
  activeMemberships,
  assertCanManage,
  assertCanView,
  canManage,
  requireGroup,
  requireRound,
} from './access';
import { recordAudit } from './audit';
import { currentUser, db, delay, newId, nowIso, persist, requireOnline, requireUser } from './db';
import { notify, notifyManagers } from './lifecycle';
import { toPublicUser } from './views';

const OPEN_STATUSES: ReadonlyArray<SwapRequest['status']> = ['pending_partner', 'pending_admin'];

function requireSwap(swapId: string): SwapRequest {
  const swap = db.swapRequests.find((s) => s.id === swapId);
  if (!swap) throw new ServiceError('Cette demande d’échange n’existe plus.', 'not_found');
  return swap;
}

function assertOpen(swap: SwapRequest): void {
  if (!OPEN_STATUSES.includes(swap.status))
    throw new ServiceError('Cette demande est déjà traitée.');
}

/** Le cycle doit être en cours (comme private.lock_active_group). */
function requireActiveGroup(groupId: string): Group {
  const group = requireGroup(groupId);
  if (group.status !== 'active') throw new ServiceError('Le cycle doit être en cours.');
  return group;
}

/**
 * Parts bénéficiaires du tour. Les tours de démonstration anciens n'ont que `beneficiaryId` :
 * on prend alors la part de ce membre à ce rang (comme les vues).
 */
function partsOf(round: Round): string[] {
  if (round.beneficiaryMembershipIds) return round.beneficiaryMembershipIds;
  const own = activeMemberships(round.groupId).filter((m) => m.userId === round.beneficiaryId);
  const part = own.find((m) => m.payoutOrder === round.number) ?? own[0];
  return part ? [part.id] : [];
}

/** Part active de `userId` parmi les bénéficiaires du tour (la première dans l'ordre). */
function partIn(round: Round, userId: string): string | undefined {
  const parts = partsOf(round);
  return activeMemberships(round.groupId)
    .filter((m) => m.userId === userId && parts.includes(m.id))
    .sort((a, b) => (a.payoutOrder ?? 0) - (b.payoutOrder ?? 0))[0]?.id;
}

/** Comme private.assert_swappable : tours à venir du cycle, parts toujours bénéficiaires. */
function assertSwappable(group: Group, swap: SwapRequest): [Round, Round] {
  const mine = requireRound(swap.requesterRoundId);
  const theirs = requireRound(swap.partnerRoundId);
  if (
    [mine, theirs].some(
      (r) =>
        r.status !== 'upcoming' || r.cycle !== group.currentCycle || r.recipientType === 'platform',
    )
  ) {
    throw new ServiceError('Seuls des tours à venir peuvent être échangés.');
  }
  const active = new Set(activeMemberships(group.id).map((m) => m.id));
  const holds = (round: Round, part: string) => active.has(part) && partsOf(round).includes(part);
  if (!holds(mine, swap.requesterMembershipId) || !holds(theirs, swap.partnerMembershipId)) {
    throw new ServiceError('Ces tours ont changé de bénéficiaire : l’échange n’est plus possible.');
  }
  return [mine, theirs];
}

/** Bénéficiaire affiché du tour : le titulaire de sa première part. */
function refreshBeneficiary(round: Round): void {
  const first = db.memberships.find((m) => m.id === round.beneficiaryMembershipIds?.[0]);
  if (!first) return;
  round.beneficiaryId = first.userId;
  round.beneficiaryShareCount = activeMemberships(round.groupId).filter(
    (m) => m.userId === first.userId,
  ).length;
}

function close(swap: SwapRequest, status: SwapRequest['status']): void {
  swap.status = status;
  swap.decidedAt = nowIso();
}

export const mockSwapService: SwapService = {
  async list(groupId) {
    await delay();
    const user = currentUser();
    const group = requireGroup(groupId);
    assertCanView(group, user);
    const manager = canManage(group, user);
    return db.swapRequests
      .filter(
        (s) =>
          s.groupId === groupId &&
          s.cycle === group.currentCycle &&
          (manager || s.requesterId === user.id || s.partnerId === user.id),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((request) => ({
        request,
        requester: toPublicUser(requireUser(request.requesterId), manager),
        partner: toPublicUser(requireUser(request.partnerId), manager),
        requesterRound: requireRound(request.requesterRoundId),
        partnerRound: requireRound(request.partnerRoundId),
      }));
  },

  async request(myRoundId, partnerRoundId, requestedPartnerId) {
    requireOnline();
    await delay();
    const user = currentUser();
    const myRound = requireRound(myRoundId);
    const partnerRound = requireRound(partnerRoundId);
    const group = requireActiveGroup(myRound.groupId);
    // Tour anonyme : le membre de ce tour est retrouvé (sa première part dans l'ordre).
    const partnerId =
      requestedPartnerId ??
      activeMemberships(group.id)
        .filter((m) => m.userId !== user.id && partsOf(partnerRound).includes(m.id))
        .sort((a, b) => (a.payoutOrder ?? 0) - (b.payoutOrder ?? 0))[0]?.userId;
    if (!partnerId) throw new ServiceError('Choisissez le tour d’un autre membre.');
    if (
      partnerRound.groupId !== group.id ||
      partnerId === user.id ||
      myRoundId === partnerRoundId
    ) {
      throw new ServiceError('Choisissez le tour d’un autre membre.');
    }
    const myPart = partIn(myRound, user.id);
    if (!myPart) throw new ServiceError('Ce tour n’est pas le vôtre.', 'forbidden');
    const theirPart = partIn(partnerRound, partnerId);
    if (!theirPart) throw new ServiceError('Ce membre ne reçoit pas la cagnotte à ce tour.');
    const swap: SwapRequest = {
      id: newId('swap'),
      groupId: group.id,
      cycle: group.currentCycle,
      requesterId: user.id,
      partnerId,
      requesterRoundId: myRound.id,
      partnerRoundId: partnerRound.id,
      requesterMembershipId: myPart,
      partnerMembershipId: theirPart,
      status: 'pending_partner',
      createdAt: nowIso(),
    };
    assertSwappable(group, swap);
    const busy = db.swapRequests.some(
      (s) =>
        OPEN_STATUSES.includes(s.status) &&
        [s.requesterMembershipId, s.partnerMembershipId].some(
          (id) => id === myPart || id === theirPart,
        ),
    );
    if (busy) {
      throw new ServiceError(
        'Une demande d’échange est déjà en cours pour l’un de ces tours.',
        'conflict',
      );
    }
    db.swapRequests.push(swap);
    notify(
      partnerId,
      'swap_request',
      'Demande d’échange de tour',
      `${fullName(user)} propose d’échanger son tour ${myRound.number} (${formatDate(myRound.dueDate)}) contre votre tour ${partnerRound.number} (${formatDate(partnerRound.dueDate)}).`,
      `/groupes/${group.id}`,
    );
    persist();
  },

  async respond(swapId, accept) {
    requireOnline();
    await delay();
    const user = currentUser();
    const swap = requireSwap(swapId);
    if (swap.partnerId !== user.id)
      throw new ServiceError('Cette demande ne vous est pas adressée.', 'forbidden');
    if (swap.status !== 'pending_partner')
      throw new ServiceError('Cette demande est déjà traitée.');
    if (!accept) {
      close(swap, 'rejected');
      notify(
        swap.requesterId,
        'swap_rejected',
        'Échange refusé',
        `${fullName(user)} a refusé l’échange de tour.`,
        `/groupes/${swap.groupId}`,
      );
    } else {
      const group = requireActiveGroup(swap.groupId);
      assertSwappable(group, swap);
      swap.status = 'pending_admin';
      notify(
        swap.requesterId,
        'swap_accepted',
        'Échange accepté',
        `${fullName(user)} a accepté. Un administrateur doit maintenant valider.`,
        `/groupes/${group.id}`,
      );
      notifyManagers(
        group.id,
        'swap_request',
        'Échange de tour à valider',
        `${group.name} : ${fullName(requireUser(swap.requesterId))} et ${fullName(user)} veulent échanger leurs tours.`,
      );
    }
    persist();
  },

  async decide(swapId, approve) {
    requireOnline();
    await delay();
    const swap = requireSwap(swapId);
    const group = requireGroup(swap.groupId);
    assertCanManage(group, currentUser());
    if (swap.status !== 'pending_admin')
      throw new ServiceError('L’autre membre doit d’abord accepter.');
    const parties = [swap.requesterId, swap.partnerId];
    if (!approve) {
      close(swap, 'rejected');
      for (const userId of parties)
        notify(
          userId,
          'swap_rejected',
          'Échange refusé',
          `${group.name} : l’administrateur a refusé l’échange de tour.`,
          `/groupes/${group.id}`,
        );
      persist();
      return;
    }
    requireActiveGroup(group.id);
    const [mine, theirs] = assertSwappable(group, swap);
    const { requesterMembershipId: a, partnerMembershipId: b } = swap;
    mine.beneficiaryMembershipIds = partsOf(mine).map((id) => (id === a ? b : id));
    theirs.beneficiaryMembershipIds = partsOf(theirs).map((id) => (id === b ? a : id));
    refreshBeneficiary(mine);
    refreshBeneficiary(theirs);
    const partA = db.memberships.find((m) => m.id === a);
    const partB = db.memberships.find((m) => m.id === b);
    if (partA && partB) {
      [partA.payoutOrder, partB.payoutOrder] = [partB.payoutOrder, partA.payoutOrder];
    }
    close(swap, 'approved');
    // Le demandeur reçoit désormais au tour du partenaire, et inversement.
    for (const [userId, round] of [
      [swap.requesterId, theirs],
      [swap.partnerId, mine],
    ] as const) {
      notify(
        userId,
        'swap_approved',
        'Échange validé',
        `${group.name} : vous recevrez la cagnotte au tour ${round.number} (${formatDate(round.dueDate)}).`,
        `/groupes/${group.id}`,
      );
    }
    recordAudit(
      currentUser(),
      'swap_approved',
      `a validé l’échange de tour entre ${fullName(requireUser(swap.requesterId))} (tour ${mine.number}) et ${fullName(requireUser(swap.partnerId))} (tour ${theirs.number}) dans « ${group.name} »`,
      group.id,
    );
    persist();
  },

  async cancel(swapId) {
    requireOnline();
    await delay();
    const user = currentUser();
    const swap = requireSwap(swapId);
    if (swap.requesterId !== user.id)
      throw new ServiceError('Seul l’auteur de la demande peut l’annuler.', 'forbidden');
    assertOpen(swap);
    close(swap, 'cancelled');
    persist();
  },
};
