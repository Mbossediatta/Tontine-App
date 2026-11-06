// Paiement par versements : montant d'un versement de quelques jours (ou périodes), ou de
// tout le reste du tour. Même calcul que le serveur (private.installment), qui fait foi.
import { serviceFee } from '@/lib/tontine';
import type { Frequency, GroupOverview } from '@/types';

/** « 1 jour », « 3 semaines »… : périodes du rythme de cotisation. */
const PERIOD_WORDS: Record<Frequency, [string, string]> = {
  daily: ['jour', 'jours'],
  weekly: ['semaine', 'semaines'],
  biweekly: ['quinzaine', 'quinzaines'],
  monthly: ['mois', 'mois'],
};

export const periodsLabel = (frequency: Frequency, count: number) =>
  `${count} ${PERIOD_WORDS[frequency][count > 1 ? 1 : 0]}`;

export interface Installment {
  contribution: number;
  penalty: number;
  fee: number;
  serviceFee: number;
  /** Montant débité : versement plus frais de paiement. */
  total: number;
}

/** Cotisation qui reste à verser sur le tour (hors pénalité et frais d'adhésion). */
export const restOf = (overview: GroupOverview) =>
  overview.myAmountDue - overview.myPenalty - overview.myMembershipFeeDue;

/** Périodes restant à payer : 1 quand le tour se paie d'un coup. */
export const periodsLeft = (overview: GroupOverview) =>
  overview.myPeriodAmount > 0 ? Math.ceil(restOf(overview) / overview.myPeriodAmount) : 1;

/**
 * Versement de `periods` périodes (toutes mes parts), ou tout le reste du tour si null.
 * Les frais d'adhésion partent avec le premier versement, la pénalité avec le dernier.
 */
export function installmentOf(overview: GroupOverview, periods: number | null): Installment {
  const rest = restOf(overview);
  const contribution = periods === null ? rest : Math.min(rest, periods * overview.myPeriodAmount);
  const penalty = contribution >= rest ? overview.myPenalty : 0;
  const fee = overview.myMembershipFeeDue;
  const fees = serviceFee(contribution + penalty + fee, overview.feePercent);
  return {
    contribution,
    penalty,
    fee,
    serviceFee: fees,
    total: contribution + penalty + fee + fees,
  };
}
