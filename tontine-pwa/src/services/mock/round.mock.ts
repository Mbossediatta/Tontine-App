import { ServiceError } from '@/lib/errors';
import { formatAmount, fullName } from '@/lib/format';
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
import { currentUser, db, delay, nowIso, persist, requireOnline, requireUser } from './db';
import { recordAudit } from './audit';
import { assertGroupOpen } from './platform';
import {
  closeRound,
  cycleRounds,
  lateAfter,
  memberStatus,
  notify,
  notifyManagers,
  paidCount,
} from './lifecycle';
import { buildMemberViews, toPublicUser } from './views';

/** Seconde validation par le super admin à partir de ce montant (FCFA). */
const PAYOUT_APPROVAL_THRESHOLD = 300_000;

function assertOrderEditable(groupId: string) {
  const group = requireGroup(groupId);
  assertCanManage(group, currentUser());
  if (group.status !== 'draft') {
    throw new ServiceError('L’ordre ne peut plus être modifié après le démarrage.');
  }
  return group;
}

/** Bénéficiaire d'un tour qui n'est pas le mien : son nom reste confidentiel. */
const ANOTHER_MEMBER = { id: '', firstName: 'Un autre', lastName: 'membre' };

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
      // Calendrier confidentiel : un membre ne voit que ses propres tours (comme la base).
      const beneficiaryShares = [...shareAmounts.values()].filter(
        ({ user: person }) => manager || person.id === user.id,
      );
      const beneficiaries = beneficiaryShares.map(({ user: person }) => person);
      return {
        round: round.recipientType === 'platform' && !manager ? { ...round, potAmount: 0 } : round,
        beneficiary:
          beneficiaries[0] ??
          (round.recipientType === 'platform'
            ? toPublicUser(requireUser(round.beneficiaryId), manager)
            : ANOTHER_MEMBER),
        beneficiaries,
        beneficiaryShares,
        paidCount: paidCount(round),
        deadline: lateAfter(round).toISOString(),
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

  async markPayoutSent(roundId, userId, method, ref) {
    requireOnline();
    await delay();
    const round = requireRound(roundId);
    const group = requireGroup(round.groupId);
    const actor = currentUser();
    assertCanManage(group, actor);
    if (round.status !== 'paid_out' || round.recipientType === 'platform') {
      throw new ServiceError('Validez d’abord le versement de la cagnotte.');
    }
    const reference = ref.trim();
    if (reference.length < 3 || reference.length > 60) {
      throw new ServiceError('Indiquez la référence de la transaction (Wave ou Orange Money).');
    }
    const amount = round.beneficiaryAmounts?.[userId];
    if (amount === undefined)
      throw new ServiceError('Cette personne n’est pas bénéficiaire de ce tour.');
    if (round.transfers?.[userId]) {
      throw new ServiceError('L’envoi de cette cagnotte est déjà enregistré.', 'conflict');
    }
    round.transfers = {
      ...round.transfers,
      [userId]: { sentAt: nowIso(), method, ref: reference },
    };
    const via = method === 'wave' ? 'Wave' : 'Orange Money';
    notify(
      userId,
      'payout',
      'Cagnotte envoyée',
      `${group.name} : ${formatAmount(amount)} vous ont été envoyés par ${via} (réf. ${reference}). Confirmez la réception dans l’application.`,
      `/groupes/${group.id}`,
    );
    recordAudit(
      actor,
      'payout_sent',
      `a envoyé ${formatAmount(amount)} à ${fullName(requireUser(userId))} par ${via} (réf. ${reference}) — tour ${round.number} de « ${group.name} »`,
      group.id,
    );
    persist();
  },

  async confirmPayoutReceived(roundId) {
    requireOnline();
    await delay();
    const round = requireRound(roundId);
    const user = currentUser();
    const transfer = round.transfers?.[user.id];
    if (!transfer || transfer.receivedAt)
      throw new ServiceError('Aucun envoi à confirmer pour ce tour.');
    transfer.receivedAt = nowIso();
    const group = requireGroup(round.groupId);
    notifyManagers(
      group.id,
      'payout',
      'Cagnotte reçue',
      `${group.name} : ${fullName(user)} confirme avoir reçu sa cagnotte du tour ${round.number}.`,
    );
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
    // Passé l'heure limite, le versement se fait quand même : les impayés deviennent des dettes.
    if (!allPaid && lateAfter(round) > new Date()) {
      throw new ServiceError(
        'Tous les membres doivent avoir payé, ou l’heure limite doit être passée, avant le reversement.',
      );
    }
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
    // Seconde validation : grosse cagnotte, l'admin du groupe demande, le super admin valide.
    const collected = db.payments
      .filter((p) => p.roundId === round.id && p.status === 'paid')
      .reduce((sum, p) => sum + (p.contributionAmount ?? p.amount), 0);
    if (
      round.recipientType !== 'platform' &&
      collected >= PAYOUT_APPROVAL_THRESHOLD &&
      actor.globalRole !== 'super_admin'
    ) {
      if (!round.payoutRequestedAt) {
        round.payoutRequestedAt = nowIso();
        for (const admin of db.users.filter((u) => u.globalRole === 'super_admin')) {
          notify(
            admin.id,
            'payout_approval',
            'Versement à valider',
            `${group.name} : cagnotte de ${formatAmount(collected)} (tour ${round.number}) à valider avant le versement.`,
            '/admin/versements',
          );
        }
        persist();
      }
      return 'pending_approval';
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
    return 'paid';
  },

  async sendPayoutAuto() {
    await delay();
    throw new ServiceError(
      'L’envoi automatique n’est pas encore activé : envoyez l’argent par Wave ou Orange Money, puis notez la référence.',
      'conflict',
    );
  },
};
