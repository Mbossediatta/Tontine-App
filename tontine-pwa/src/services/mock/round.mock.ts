import { ServiceError } from '@/lib/errors';
import type { RoundService } from '../round.service';
import {
  activeMemberships,
  assertCanManage,
  assertCanView,
  assertSuperAdmin,
  canManage,
  requireGroup,
  requireRound,
} from './access';
import { currentUser, delay, persist, requireOnline, requireUser } from './db';
import { recordAudit } from './audit';
import { assertGroupOpen } from './platform';
import { closeRound, cycleRounds, memberStatus, notify, paidCount } from './lifecycle';
import { buildMemberViews, toPublicUser } from './views';

function assertOrderEditable(groupId: string) {
  const group = requireGroup(groupId);
  assertCanManage(group, currentUser());
  if (group.status !== 'draft') {
    throw new ServiceError('L’ordre ne peut plus être modifié après le démarrage.');
  }
  return group;
}

export const mockRoundService: RoundService = {
  async list(groupId) {
    await delay();
    const user = currentUser();
    const group = requireGroup(groupId);
    assertCanView(group, user);
    const manager = canManage(group, user);
    return cycleRounds(group).map((round) => {
      const recipients =
        round.recipientType === 'platform'
          ? []
          : activeMemberships(groupId).filter((member) =>
              round.beneficiaryMembershipIds
                ? round.beneficiaryMembershipIds.includes(member.id)
                : member.userId === round.beneficiaryId,
            );
      const shareValue = Math.floor(round.potAmount / Math.max(1, recipients.length));
      let remainder = round.potAmount - shareValue * recipients.length;
      const shareAmounts = new Map<
        string,
        { user: ReturnType<typeof toPublicUser>; shareCount: number; amount: number }
      >();
      for (const member of recipients) {
        const amount = shareValue + (remainder > 0 ? 1 : 0);
        remainder = Math.max(0, remainder - 1);
        const existing = shareAmounts.get(member.userId);
        if (existing) {
          existing.shareCount += 1;
          existing.amount += amount;
        } else {
          shareAmounts.set(member.userId, {
            user: toPublicUser(requireUser(member.userId), manager),
            shareCount: 1,
            amount,
          });
        }
      }
      const beneficiaryShares = [...shareAmounts.values()];
      const beneficiaries = beneficiaryShares.map(({ user: person }) => person);
      return {
        round: round.recipientType === 'platform' && !manager ? { ...round, potAmount: 0 } : round,
        beneficiary: beneficiaries[0] ?? toPublicUser(requireUser(round.beneficiaryId), manager),
        beneficiaries,
        beneficiaryShares,
        paidCount: paidCount(round),
      };
    });
  },

  async drawOrder(groupId) {
    requireOnline();
    await delay();
    const group = assertOrderEditable(groupId);
    const members = activeMemberships(groupId);
    const shuffled = members.slice();
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const a = shuffled[i];
      const b = shuffled[j];
      if (a && b) {
        shuffled[i] = b;
        shuffled[j] = a;
      }
    }
    shuffled.forEach((membership, index) => {
      membership.payoutOrder = index + 1;
      notify(
        membership.userId,
        'draw',
        'Tirage au sort effectué',
        `${group.name} : vous recevrez la cagnotte au tour ${index + 1}.`,
        `/groupes/${groupId}`,
      );
    });
    persist();
    return buildMemberViews(group, currentUser()).filter((m) => m.membership.status === 'active');
  },

  async setManualOrder(groupId, membershipIds) {
    requireOnline();
    await delay();
    assertOrderEditable(groupId);
    const members = activeMemberships(groupId);
    const ids = new Set(membershipIds);
    if (ids.size !== members.length || members.some((m) => !ids.has(m.id))) {
      throw new ServiceError('L’ordre doit contenir chaque membre une seule fois.');
    }
    membershipIds.forEach((id, index) => {
      const membership = members.find((m) => m.id === id);
      if (membership) membership.payoutOrder = index + 1;
    });
    persist();
  },

  async payout(roundId) {
    requireOnline();
    await delay();
    const round = requireRound(roundId);
    const group = requireGroup(round.groupId);
    const actor = currentUser();
    assertCanManage(group, actor);
    if (round.recipientType === 'platform') assertSuperAdmin(actor);
    assertGroupOpen(group);
    if (round.payoutBlockedAt) {
      throw new ServiceError(
        `Versement bloqué par l’administration de la plateforme : ${round.payoutBlockReason ?? 'vérification en cours'}.`,
      );
    }
    const members = activeMemberships(group.id);
    const allPaid = members.every((m) => memberStatus(round, m.userId) === 'paid');
    if (round.status === 'paid_out') throw new ServiceError('Cette cagnotte a déjà été reversée.');
    if (!allPaid)
      throw new ServiceError('Tous les membres doivent avoir payé avant le reversement.');
    if (round.recipientType !== 'platform') {
      const recipients = new Set(
        activeMemberships(group.id)
          .filter((member) =>
            round.beneficiaryMembershipIds
              ? round.beneficiaryMembershipIds.includes(member.id)
              : member.userId === round.beneficiaryId,
          )
          .map((member) => member.userId),
      );
      const missing = [...recipients].find((userId) => !requireUser(userId).payoutPhone);
      if (missing) {
        throw new ServiceError('Un bénéficiaire n’a pas renseigné de numéro de reversement.');
      }
    }
    round.payoutValidatedBy = actor.id;
    closeRound(round);
    recordAudit(
      actor,
      'payout_validated',
      `a validé le versement du tour ${round.number} — ${group.name}`,
      group.id,
    );
    persist();
  },
};
