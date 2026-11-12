// Règles de calcul d'une tontine (cagnotte, durée, calendrier).
import { addDays, addMonths, addWeeks, getISODay, setDate } from 'date-fns';
import type { Frequency, Group, Round } from '@/types';

/** Cagnotte d'un tour = cotisation × nombre de membres. */
export function computePot(contributionAmount: number, memberCount: number): number {
  if (!Number.isFinite(contributionAmount) || !Number.isFinite(memberCount)) return 0;
  if (contributionAmount <= 0 || memberCount <= 0) return 0;
  return Math.round(contributionAmount) * Math.round(memberCount);
}

/**
 * Plusieurs parts par tour : la cagnotte se partage à parts égales entre les parts
 * bénéficiaires. Montant d'une part (arrondi au franc inférieur ; le reste éventuel va
 * aux premières parts, voir personPayout).
 */
export function payoutPerShare(potAmount: number, sharesPerRound: number | undefined): number {
  return Math.floor(potAmount / Math.max(1, sharesPerRound ?? 1));
}

/**
 * Les parts du groupe doivent tomber juste en lots de `sharesPerRound` : sinon le dernier
 * tour a moins de bénéficiaires et chacun y touche une cagnotte plus grosse que les autres,
 * pour la même cotisation. Renvoie le message d'erreur, ou null si tout va bien.
 * Même règle côté serveur (private.check_even_shares).
 */
export function unevenSharesMessage(
  maxMembers: number,
  sharesPerRound: number | undefined,
): string | null {
  const perRound = Math.max(1, sharesPerRound ?? 1);
  if (!Number.isFinite(maxMembers) || maxMembers < perRound) return null;
  if (maxMembers % perRound === 0) return null;
  const lower = Math.floor(maxMembers / perRound) * perRound;
  const upper = lower + perRound;
  return (
    `Avec ${perRound} parts par tour, le nombre total de parts doit être un multiple de ` +
    `${perRound} (${lower} ou ${upper}) : sinon le dernier tour aurait moins de ` +
    'bénéficiaires et chacun y recevrait plus que les autres pour la même cotisation.'
  );
}

/**
 * Ce que reçoit une personne sur un tour, avant versement : ses parts (`mine`, ids
 * d'adhésion) parmi celles du tour (`order`, dans l'ordre du tour). Le reste de la division
 * revient aux premières parts, comme au versement.
 */
export function personPayout(
  potAmount: number,
  order: string[],
  mine: ReadonlySet<string>,
): number {
  const share = payoutPerShare(potAmount, order.length);
  const remainder = potAmount - share * Math.max(1, order.length);
  return order.reduce(
    (sum, id, index) => (mine.has(id) ? sum + share + (index < remainder ? 1 : 0) : sum),
    0,
  );
}

/** Durée maximale d'un tour : un an (365 jours, 52 semaines, 26 quinzaines), deux ans en mensuel. */
export const MAX_TURN_LENGTH: Record<Frequency, number> = {
  daily: 365,
  weekly: 52,
  biweekly: 26,
  monthly: 24,
};

/** `count` périodes du rythme : « 10 jours », « 3 semaines », « 2 mois » (quinzaines en semaines). */
export function formatPeriods(frequency: Frequency, count: number): string {
  if (count <= 0) return '—';
  if (frequency === 'monthly') return `${count} mois`;
  if (frequency === 'daily') return `${count} jour${count > 1 ? 's' : ''}`;
  const weeks = frequency === 'weekly' ? count : count * 2;
  return `${weeks} semaine${weeks > 1 ? 's' : ''}`;
}

/** Durée d'un cycle : `rounds` tours de `turnLength` périodes. « 20 mois », « 30 jours ». */
export function formatCycleDuration(frequency: Frequency, rounds: number, turnLength = 1): string {
  return formatPeriods(frequency, rounds * Math.max(1, turnLength));
}

/** Cotisation d'une part pour un tour entier : montant par période × durée du tour. */
export function contributionPerTurn(
  group: Pick<Group, 'contributionAmount' | 'turnLength' | 'platformSharePercent'>,
  round?: Pick<Round, 'recipientType'>,
): number {
  return periodContribution(group, round) * Math.max(1, group.turnLength);
}

/**
 * Cotisation d'une période pour une part : entière entre membres, réduite pendant la
 * période de service de la plateforme (platformSharePercent, arrondie au franc). Même
 * calcul que private.period_contribution.
 */
export function periodContribution(
  group: Pick<Group, 'contributionAmount' | 'platformSharePercent'>,
  round?: Pick<Round, 'recipientType'>,
): number {
  if (round?.recipientType !== 'platform') return group.contributionAmount;
  return Math.round((group.contributionAmount * (group.platformSharePercent ?? 100)) / 100);
}

/** `count` périodes du rythme après `start`. */
function addPeriods(start: Date, frequency: Frequency, count: number): Date {
  if (frequency === 'monthly') return addMonths(start, count);
  if (frequency === 'daily') return addDays(start, count);
  return addWeeks(start, frequency === 'weekly' ? count : count * 2);
}

/** Date d'ouverture du tour d'index `index` (0 pour le premier) ; un tour dure `turnLength` périodes. */
export function roundOpenDate(
  start: Date,
  frequency: Frequency,
  index: number,
  turnLength = 1,
): Date {
  return addPeriods(start, frequency, index * Math.max(1, turnLength));
}

/**
 * Date limite d'un tour, dans sa dernière période.
 * Journalier : dernier jour du tour (`dueDay` ne sert pas).
 * Mensuel : `dueDay` est le jour du mois (1 à 28).
 * Hebdomadaire et quinzaine : `dueDay` est le jour de la semaine (1 = lundi … 7 = dimanche).
 */
export function computeDueDate(
  openDate: Date,
  frequency: Frequency,
  dueDay: number,
  turnLength = 1,
): Date {
  const lastPeriod = addPeriods(openDate, frequency, Math.max(1, turnLength) - 1);
  if (frequency === 'daily') return lastPeriod;
  if (frequency === 'monthly') {
    const sameMonth = setDate(lastPeriod, dueDay);
    return sameMonth < lastPeriod ? addMonths(sameMonth, 1) : sameMonth;
  }
  const diff = (dueDay - getISODay(lastPeriod) + 7) % 7;
  return addDays(lastPeriod, diff);
}

/** Jour limite le plus grand : jour du mois (mensuel), de la semaine, aucun (journalier). */
export function maxDueDay(frequency: Frequency): number {
  if (frequency === 'daily') return 0;
  return frequency === 'monthly' ? 28 : 7;
}

/**
 * Frais du service de paiement (PayTech) payés par le membre : pourcentage du montant,
 * arrondi au franc supérieur. Le pourcentage vient des paramètres de la plateforme
 * (payment.feePercent) ; c'est le serveur qui fait foi.
 */
/**
 * Moment où un membre qui n'a pas tout payé passe en retard (comme private.round_deadline) :
 * jour limite du tour à l'heure limite du groupe (heure de Dakar = UTC), plus le délai de grâce.
 */
export function roundDeadline(dueDate: string, graceDays: number, dueTime = '23:59'): Date {
  const deadline = new Date(`${dueDate.slice(0, 10)}T${dueTime}:00Z`);
  deadline.setUTCDate(deadline.getUTCDate() + graceDays);
  return deadline;
}

/**
 * La cagnotte peut être versée : tout le monde a payé (tour « prêt »), ou l'heure limite
 * est passée (les impayés deviennent alors des dettes).
 */
export function payoutOpen(
  view: { round: { status: string }; deadline: string },
  now: Date = new Date(),
): boolean {
  return (
    view.round.status === 'ready_for_payout' ||
    (view.round.status === 'open' && new Date(view.deadline) <= now)
  );
}

/** « à 12h00 » : heure limite affichée, rien pour la fin de journée par défaut. */
export function dueTimeLabel(dueTime?: string): string {
  return dueTime && dueTime !== '23:59' ? ` à ${dueTime.replace(':', 'h')}` : '';
}

export function serviceFee(amount: number, feePercent: number): number {
  if (amount <= 0 || feePercent <= 0) return 0;
  return Math.ceil((amount * feePercent) / 100);
}
