import { isSameMonth } from 'date-fns';
import { ServiceError } from '@/lib/errors';
import { fullName } from '@/lib/format';
import type { PayoutRow, PayoutStage, Round } from '@/types';
import type { FinanceService } from '../finance.service';
import { assertSuperAdmin, requireGroup, requireRound } from './access';
import { recordAudit } from './audit';
import { synchronize } from './clock';
import { currentUser, db, delay, findUser, newId, persist, requireOnline } from './db';
import { notify, notifyManagers } from './lifecycle';
import { roundCollected, roundExpected, sumCollection } from './metrics';
import { adminNameOf, allTransactions } from './platform';
import { earningsBalance, platformIncomeRows } from './revenue';
import { toPublicUser } from './views';

/** Étape d'un versement : un blocage l'emporte sur tout ce qui n'est pas encore versé. */
function stageOf(round: Round): PayoutStage {
  if (round.status === 'paid_out') return 'paid';
  if (round.payoutBlockedAt) return 'blocked';
  // Grosse cagnotte : l'admin a demandé, le super admin doit valider.
  if (round.payoutRequestedAt) return 'approval';
  if (round.status === 'ready_for_payout') return 'ready';
  return round.status === 'open' ? 'collecting' : 'upcoming';
}

/** Ordre d'affichage : ce qui demande de l'attention d'abord. */
const STAGE_ORDER: Record<PayoutStage, number> = {
  blocked: 0,
  approval: 1,
  ready: 2,
  collecting: 3,
  upcoming: 4,
  paid: 5,
};

async function superAdminAction() {
  requireOnline();
  await delay();
  const actor = currentUser();
  assertSuperAdmin(actor);
  return actor;
}

export const mockFinanceService: FinanceService = {
  async reconciliation(month) {
    await delay();
    synchronize();
    assertSuperAdmin(currentUser());
    const target = new Date(month);
    const inMonth = (iso?: string) => !!iso && isSameMonth(new Date(iso), target);

    // Ce que l'application a enregistré comme payé ce mois-ci.
    const paid = allTransactions().filter(
      (row) => row.payment.status === 'paid' && inMonth(row.payment.paidAt),
    );
    const online = paid.filter((row) => row.payment.method !== 'cash');
    const cash = paid.filter((row) => row.payment.method === 'cash');

    // Ce que le service de paiement dit avoir encaissé ce mois-ci.
    const ledger = db.providerLedger.filter((entry) => inMonth(entry.at));
    const ledgerRefs = new Set(ledger.map((entry) => entry.ref));
    // Toutes périodes confondues : un paiement enregistré n'est pas un « orphelin ».
    const appRefs = new Set(
      db.payments.filter((p) => p.status === 'paid' && p.providerRef).map((p) => p.providerRef),
    );

    const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
    return {
      month: target.toISOString(),
      expected: sumCollection(db.rounds.filter((r) => isSameMonth(new Date(r.dueDate), target)))
        .expected,
      recordedOnline: sum(online.map((row) => row.payment.amount)),
      recordedCash: sum(cash.map((row) => row.payment.amount)),
      provider: sum(ledger.map((entry) => entry.amount)),
      providerOnly: ledger
        .filter((entry) => !appRefs.has(entry.ref))
        .map((entry) => {
          const user = db.users.find((u) => u.phone === entry.phone);
          return { ...entry, userName: user ? fullName(user) : undefined };
        }),
      appOnly: online.filter((row) => !ledgerRefs.has(row.payment.providerRef ?? '')),
      matched: online.filter((row) => ledgerRefs.has(row.payment.providerRef ?? '')).length,
    };
  },

  async payouts() {
    await delay();
    synchronize();
    assertSuperAdmin(currentUser());
    const rows: PayoutRow[] = db.rounds.flatMap((round) => {
      const group = db.groups.find((g) => g.id === round.groupId);
      const beneficiary =
        findUser(round.beneficiaryId) ?? db.users.find((user) => user.globalRole === 'super_admin');
      if (!group || !beneficiary || group.archivedAt) return [];
      const validator = round.payoutValidatedBy ? findUser(round.payoutValidatedBy) : undefined;
      const recipients = db.memberships
        .filter((membership) => round.beneficiaryMembershipIds?.includes(membership.id))
        .map((membership) => findUser(membership.userId))
        .filter((user): user is NonNullable<typeof user> => Boolean(user));
      return [
        {
          round,
          groupId: group.id,
          groupName: group.name,
          adminName: adminNameOf(group),
          beneficiary: toPublicUser(beneficiary, true),
          beneficiaries: recipients.map((user) => toPublicUser(user, true)),
          stage: stageOf(round),
          collected: roundCollected(round),
          expected: roundExpected(round),
          validatedByName: validator ? fullName(validator) : undefined,
        },
      ];
    });
    return rows.sort((a, b) => {
      const byStage = STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage];
      if (byStage !== 0) return byStage;
      // Effectués : le plus récent d'abord ; les autres : le plus proche d'abord.
      return a.stage === 'paid'
        ? (b.round.paidOutAt ?? '').localeCompare(a.round.paidOutAt ?? '')
        : a.round.dueDate.localeCompare(b.round.dueDate);
    });
  },

  async earnings() {
    await delay();
    synchronize();
    assertSuperAdmin(currentUser());
    const earnings = platformIncomeRows();
    const compensations = db.adminCompensations.map((entry) => {
      const group = db.groups.find((item) => item.id === entry.groupId);
      const admin = findUser(entry.adminId);
      return {
        ...entry,
        groupName: group?.name ?? 'Groupe supprimé',
        adminName: admin ? fullName(admin) : 'Admin supprimé',
      };
    });
    const earnedTotal = earnings.reduce((sum, entry) => sum + entry.amount, 0);
    const compensatedTotal = compensations.reduce((sum, entry) => sum + entry.amount, 0);
    return {
      earnings,
      compensations,
      earnedTotal,
      compensatedTotal,
      available: db.groups.reduce((sum, group) => sum + earningsBalance(group.id), 0),
    };
  },

  async compensateAdmin(groupId, amount, note) {
    const actor = await superAdminAction();
    const group = requireGroup(groupId);
    if (!Number.isSafeInteger(amount) || amount < 1) {
      throw new ServiceError('Le montant doit être un nombre entier supérieur à zéro.');
    }
    const balance = earningsBalance(groupId);
    if (amount > balance) {
      throw new ServiceError(
        `Le montant dépasse les revenus disponibles du groupe (${balance} FCFA).`,
      );
    }
    const message = note.trim();
    if (!message) throw new ServiceError('Indiquez le motif de cette rémunération.');
    db.adminCompensations.push({
      id: newId('comp'),
      groupId,
      adminId: group.adminId,
      amount,
      note: message,
      at: new Date().toISOString(),
      paidBy: actor.id,
    });
    const admin = findUser(group.adminId);
    if (admin) {
      notify(
        admin.id,
        'admin_compensation',
        'Rémunération reçue',
        `Le Superadmin vous a versé ${amount} FCFA pour « ${group.name} ».`,
        `/admin/groupes/${group.id}`,
      );
    }
    recordAudit(
      actor,
      'admin_compensated',
      `a versé ${amount} FCFA à l’administrateur de « ${group.name} »`,
      group.id,
    );
    persist();
  },

  async blockPayout(roundId, reason) {
    const actor = await superAdminAction();
    const round = requireRound(roundId);
    const group = requireGroup(round.groupId);
    if (round.status === 'paid_out') throw new ServiceError('Cette cagnotte a déjà été versée.');
    const why = reason.trim();
    if (!why) throw new ServiceError('Indiquez la raison du blocage.');
    round.payoutBlockedAt = new Date().toISOString();
    round.payoutBlockReason = why;
    notifyManagers(
      group.id,
      'admin',
      'Versement bloqué',
      `${group.name} : le versement du tour ${round.number} est bloqué (${why}).`,
    );
    recordAudit(
      actor,
      'payout_blocked',
      `a bloqué le versement du tour ${round.number} — ${group.name} (${why})`,
      group.id,
    );
    persist();
  },

  async unblockPayout(roundId) {
    const actor = await superAdminAction();
    const round = requireRound(roundId);
    const group = requireGroup(round.groupId);
    if (!round.payoutBlockedAt) throw new ServiceError('Ce versement n’est pas bloqué.');
    round.payoutBlockedAt = undefined;
    round.payoutBlockReason = undefined;
    notifyManagers(
      group.id,
      'admin',
      'Versement débloqué',
      `${group.name} : le versement du tour ${round.number} peut de nouveau être validé.`,
    );
    recordAudit(
      actor,
      'payout_unblocked',
      `a débloqué le versement du tour ${round.number} — ${group.name}`,
      group.id,
    );
    persist();
  },
};
