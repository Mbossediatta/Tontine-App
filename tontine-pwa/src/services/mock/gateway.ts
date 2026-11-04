// Agrégateur de paiement simulé (remplace PayDunya / PayTech en mode mock).
// La confirmation arrive quelques secondes après le retour, comme un webhook.
import { ServiceError } from '@/lib/errors';
import { formatAmount, fullName } from '@/lib/format';
import { requireGroup, requireRound } from './access';
import { db, delay, nowIso, persist, requireUser } from './db';
import { notify, notifyManagers, refreshRound } from './lifecycle';
import { sendSmsToUser } from './sms';
import { recordPaymentEarnings } from './revenue';

const CONFIRMATION_DELAY_MS = 4000;

export interface SimulatedCheckout {
  paymentId: string;
  amount: number;
  method: string;
  groupName: string;
}

export async function getSimulatedCheckout(paymentId: string): Promise<SimulatedCheckout> {
  await delay();
  const payment = db.payments.find((p) => p.id === paymentId);
  if (!payment) throw new ServiceError('Paiement introuvable.', 'not_found');
  const group = requireGroup(requireRound(payment.roundId).groupId);
  return { paymentId, amount: payment.amount, method: payment.method, groupName: group.name };
}

/** Résultat choisi sur la page de simulation ; le statut ne change qu'après le délai. */
export async function completeSimulatedCheckout(paymentId: string, success: boolean) {
  await delay();
  if (!db.payments.some((p) => p.id === paymentId)) {
    throw new ServiceError('Paiement introuvable.', 'not_found');
  }
  db.pendingConfirmations[paymentId] = { at: Date.now() + CONFIRMATION_DELAY_MS, success };
  persist();
}

/** Applique les confirmations dont le délai est écoulé. */
export function applyPendingConfirmations(now: number = Date.now()): void {
  const entries = Object.entries(db.pendingConfirmations);
  const due = entries.filter(([, confirmation]) => confirmation.at <= now);
  if (due.length === 0) return;
  db.pendingConfirmations = Object.fromEntries(
    entries.filter(([, confirmation]) => confirmation.at > now),
  );
  for (const [paymentId, confirmation] of due) {
    const payment = db.payments.find((p) => p.id === paymentId);
    if (!payment || payment.status !== 'pending') continue;
    const round = requireRound(payment.roundId);
    const group = requireGroup(round.groupId);
    if (!confirmation.success) {
      payment.status = 'failed';
      notify(
        payment.userId,
        'payment_failed',
        'Paiement échoué',
        `${group.name} : le paiement n’a pas abouti.`,
        `/groupes/${group.id}`,
      );
      continue;
    }
    payment.status = 'paid';
    payment.paidAt = nowIso();
    recordPaymentEarnings(payment, group);
    db.providerLedger.push({
      ref: payment.providerRef ?? payment.id,
      phone: requireUser(payment.userId).phone,
      amount: payment.amount,
      at: payment.paidAt,
    });
    sendSmsToUser(payment.userId, 'payment');
    // Le paiement remplace un éventuel statut « en retard » enregistré pour ce tour.
    db.payments = db.payments.filter(
      (p) => !(p.roundId === payment.roundId && p.userId === payment.userId && p.status === 'late'),
    );
    notify(
      payment.userId,
      'payment',
      'Paiement confirmé',
      `${group.name} : ${formatAmount(payment.amount)} reçus pour le tour ${round.number}.`,
      `/groupes/${group.id}`,
    );
    notifyManagers(
      group.id,
      'payment',
      'Paiement reçu',
      `${fullName(requireUser(payment.userId))} a payé ${formatAmount(payment.amount)}.`,
    );
    refreshRound(round);
  }
  persist();
}
