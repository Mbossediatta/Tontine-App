import { ServiceError } from '@/lib/errors';
import { formatAmount, fullName } from '@/lib/format';
import type { Dispute, DisputeView, User } from '@/types';
import type { DisputeService } from '../dispute.service';
import { assertSuperAdmin, requireGroup, requireRound } from './access';
import { recordAudit } from './audit';
import { synchronize } from './clock';
import { currentUser, db, delay, findUser, newId, nowIso, persist, requireOnline } from './db';
import { memberStatus, notify, refreshRound } from './lifecycle';
import { toPublicUser } from './views';

function requireDispute(disputeId: string): Dispute {
  const dispute = db.disputes.find((d) => d.id === disputeId);
  if (!dispute) throw new ServiceError('Ce litige est introuvable.', 'not_found');
  return dispute;
}

/** Un litige clôturé (résolu ou rejeté) ne bouge plus. */
function requireOpen(dispute: Dispute): void {
  if (dispute.status === 'resolved' || dispute.status === 'rejected') {
    throw new ServiceError('Ce litige est déjà clôturé.');
  }
}

/** Ajoute une étape au suivi, prévient le membre et trace l'action au journal d'audit. */
function track(dispute: Dispute, actor: User, text: string, memberMessage: string): void {
  dispute.history.push({ at: nowIso(), actorId: actor.id, text });
  notify(
    dispute.userId,
    'dispute',
    'Votre réclamation',
    memberMessage,
    `/groupes/${dispute.groupId}`,
  );
  const member = findUser(dispute.userId);
  recordAudit(
    actor,
    'dispute_updated',
    `a traité le litige de ${member ? fullName(member) : '—'} : ${text.toLowerCase()}`,
    dispute.groupId,
  );
}

async function superAdminAction(): Promise<User> {
  requireOnline();
  await delay();
  const actor = currentUser();
  assertSuperAdmin(actor);
  return actor;
}

function toView(dispute: Dispute): DisputeView {
  const user = findUser(dispute.userId);
  return {
    dispute,
    user: user
      ? toPublicUser(user, true)
      : { id: dispute.userId, firstName: 'Compte', lastName: 'supprimé' },
    groupName: db.groups.find((g) => g.id === dispute.groupId)?.name ?? '—',
    payment: db.payments.find((p) => p.id === dispute.paymentId),
    history: dispute.history.map((event) => {
      const actor = findUser(event.actorId);
      return { ...event, actorName: actor ? fullName(actor) : '—' };
    }),
  };
}

export const mockDisputeService: DisputeService = {
  async open(input) {
    requireOnline();
    await delay();
    const user = currentUser();
    const group = requireGroup(input.groupId);
    if (!db.memberships.some((m) => m.groupId === group.id && m.userId === user.id)) {
      throw new ServiceError('Vous ne faites pas partie de ce groupe.', 'forbidden');
    }
    const description = input.description.trim();
    if (description.length < 5 || description.length > 1000) {
      throw new ServiceError('Expliquez le problème en quelques mots (5 à 1 000 caractères).');
    }
    const ongoing = db.disputes.filter(
      (d) => d.userId === user.id && (d.status === 'open' || d.status === 'in_progress'),
    );
    if (ongoing.length >= 5) {
      throw new ServiceError(
        'Vous avez déjà 5 réclamations en cours : attendez leur traitement.',
        'conflict',
      );
    }
    db.disputes.push({
      id: newId('dis'),
      userId: user.id,
      groupId: group.id,
      roundId: input.roundId,
      providerRef: input.providerRef?.trim() || undefined,
      method: input.method,
      kind: input.kind,
      description,
      amount: input.amount,
      status: 'open',
      createdAt: nowIso(),
      history: [
        {
          at: nowIso(),
          actorId: user.id,
          text: `Réclamation ouverte par le membre : ${description}`,
        },
      ],
    });
    for (const admin of db.users.filter((u) => u.globalRole === 'super_admin')) {
      notify(
        admin.id,
        'dispute',
        'Nouvelle réclamation',
        `${fullName(user)} (${group.name}) : ${description.slice(0, 200)}`,
        '/admin/litiges',
      );
    }
    persist();
  },

  async listMine() {
    await delay();
    const user = currentUser();
    return db.disputes
      .filter((d) => d.userId === user.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((dispute) => ({
        dispute,
        groupName: db.groups.find((g) => g.id === dispute.groupId)?.name ?? '—',
        roundNumber: dispute.roundId
          ? db.rounds.find((r) => r.id === dispute.roundId)?.number
          : undefined,
        history: dispute.history,
      }));
  },

  async list() {
    await delay();
    synchronize();
    assertSuperAdmin(currentUser());
    return [...db.disputes].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(toView);
  },

  async take(disputeId) {
    const actor = await superAdminAction();
    const dispute = requireDispute(disputeId);
    if (dispute.status !== 'open') throw new ServiceError('Ce litige est déjà pris en charge.');
    dispute.status = 'in_progress';
    track(dispute, actor, 'Prise en charge', 'Votre réclamation est en cours de traitement.');
    persist();
  },

  async recordPayment(disputeId) {
    const actor = await superAdminAction();
    const dispute = requireDispute(disputeId);
    requireOpen(dispute);
    if (dispute.kind !== 'debited_not_recorded' || !dispute.roundId) {
      throw new ServiceError('Cette action concerne un paiement débité mais non enregistré.');
    }
    // Le débit doit figurer sur le relevé du service de paiement : c'est la preuve.
    const proof = db.providerLedger.find((entry) => entry.ref === dispute.providerRef);
    if (!proof) {
      throw new ServiceError('Ce paiement est absent du relevé du service de paiement.');
    }
    const round = requireRound(dispute.roundId);
    const group = requireGroup(round.groupId);
    if (memberStatus(round, dispute.userId) === 'paid') {
      throw new ServiceError('Ce membre est déjà enregistré comme ayant payé ce tour.');
    }
    db.payments.push({
      id: newId('pay'),
      roundId: round.id,
      userId: dispute.userId,
      amount: proof.amount,
      method: dispute.method ?? 'orange_money',
      providerRef: proof.ref,
      status: 'paid',
      paidAt: proof.at,
      createdAt: proof.at,
    });
    refreshRound(round);
    dispute.status = 'resolved';
    track(
      dispute,
      actor,
      `Paiement de ${formatAmount(proof.amount)} enregistré (réf. ${proof.ref})`,
      `${group.name} : votre paiement de ${formatAmount(proof.amount)} est maintenant enregistré.`,
    );
    persist();
  },

  async refund(disputeId, amount, note) {
    const actor = await superAdminAction();
    const dispute = requireDispute(disputeId);
    requireOpen(dispute);
    if (!Number.isInteger(amount) || amount <= 0) throw new ServiceError('Montant invalide.');
    if (amount > dispute.amount) {
      throw new ServiceError(
        `Le remboursement ne peut pas dépasser ${formatAmount(dispute.amount)}.`,
      );
    }
    // Double paiement : le paiement en trop passe « remboursé » (il ne compte plus comme collecté).
    const payment = db.payments.find((p) => p.id === dispute.paymentId);
    if (payment && payment.amount === amount) payment.status = 'refunded';
    dispute.refund = { amount, validatedAt: nowIso(), validatedBy: actor.id };
    dispute.status = 'resolved';
    track(
      dispute,
      actor,
      `Remboursement de ${formatAmount(amount)} validé${note.trim() ? ` : ${note.trim()}` : ''}`,
      `Un remboursement de ${formatAmount(amount)} a été validé. Vous le recevrez sur votre numéro.`,
    );
    recordAudit(
      actor,
      'refund_validated',
      `a validé un remboursement de ${formatAmount(amount)}`,
      dispute.groupId,
    );
    persist();
  },

  async reject(disputeId, note) {
    const actor = await superAdminAction();
    const dispute = requireDispute(disputeId);
    requireOpen(dispute);
    const reason = note.trim();
    if (!reason) throw new ServiceError('Expliquez au membre pourquoi la réclamation est rejetée.');
    dispute.status = 'rejected';
    track(
      dispute,
      actor,
      `Rejeté : ${reason}`,
      `Votre réclamation n’a pas été retenue : ${reason}`,
    );
    persist();
  },
};
