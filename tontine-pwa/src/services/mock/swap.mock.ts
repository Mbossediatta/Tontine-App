import { ServiceError } from '@/lib/errors';
import { formatDate, fullName } from '@/lib/format';
import type { Round, SwapRequest } from '@/types';
import type { SwapService } from '../swap.service';
import {
  assertCanManage,
  assertCanView,
  canManage,
  membershipOf,
  requireGroup,
  requireRound,
} from './access';
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

/** Les deux tours doivent être encore à venir pour pouvoir être échangés. */
function assertSwappable(...rounds: Round[]): void {
  if (rounds.some((r) => r.status !== 'upcoming')) {
    throw new ServiceError('Seuls des tours à venir peuvent être échangés.');
  }
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

  async request(groupId, partnerRoundId) {
    requireOnline();
    await delay();
    const user = currentUser();
    const group = requireGroup(groupId);
    if (group.status !== 'active') throw new ServiceError('Le cycle doit être en cours.');
    if (membershipOf(groupId, user.id)?.status !== 'active') {
      throw new ServiceError('Vous ne faites pas partie de ce groupe.', 'forbidden');
    }
    const partnerRound = requireRound(partnerRoundId);
    const myRound = db.rounds.find(
      (r) => r.groupId === groupId && r.cycle === group.currentCycle && r.beneficiaryId === user.id,
    );
    if (!myRound) throw new ServiceError('Vous n’avez pas de tour dans ce cycle.');
    if (partnerRound.groupId !== groupId || partnerRound.beneficiaryId === user.id) {
      throw new ServiceError('Choisissez le tour d’un autre membre.');
    }
    assertSwappable(myRound, partnerRound);
    const busy = db.swapRequests.some(
      (s) =>
        OPEN_STATUSES.includes(s.status) &&
        [s.requesterRoundId, s.partnerRoundId].some(
          (id) => id === myRound.id || id === partnerRound.id,
        ),
    );
    if (busy)
      throw new ServiceError('Une demande d’échange est déjà en cours pour l’un de ces tours.');
    db.swapRequests.push({
      id: newId('swap'),
      groupId,
      cycle: group.currentCycle,
      requesterId: user.id,
      partnerId: partnerRound.beneficiaryId,
      requesterRoundId: myRound.id,
      partnerRoundId: partnerRound.id,
      status: 'pending_partner',
      createdAt: nowIso(),
    });
    notify(
      partnerRound.beneficiaryId,
      'swap_request',
      'Demande d’échange de tour',
      `${fullName(user)} propose d’échanger son tour ${myRound.number} (${formatDate(myRound.dueDate)}) contre votre tour ${partnerRound.number}.`,
      `/groupes/${groupId}`,
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
    const group = requireGroup(swap.groupId);
    if (!accept) {
      close(swap, 'rejected');
      notify(
        swap.requesterId,
        'swap_rejected',
        'Échange refusé',
        `${fullName(user)} a refusé l’échange de tour.`,
        `/groupes/${group.id}`,
      );
    } else {
      assertSwappable(requireRound(swap.requesterRoundId), requireRound(swap.partnerRoundId));
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
    const mine = requireRound(swap.requesterRoundId);
    const theirs = requireRound(swap.partnerRoundId);
    assertSwappable(mine, theirs);
    [mine.beneficiaryId, theirs.beneficiaryId] = [theirs.beneficiaryId, mine.beneficiaryId];
    const a = membershipOf(group.id, swap.requesterId);
    const b = membershipOf(group.id, swap.partnerId);
    if (a && b) [a.payoutOrder, b.payoutOrder] = [b.payoutOrder, a.payoutOrder];
    close(swap, 'approved');
    for (const userId of parties) {
      const round = mine.beneficiaryId === userId ? mine : theirs;
      notify(
        userId,
        'swap_approved',
        'Échange validé',
        `${group.name} : vous recevrez la cagnotte au tour ${round.number} (${formatDate(round.dueDate)}).`,
        `/groupes/${group.id}`,
      );
    }
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
