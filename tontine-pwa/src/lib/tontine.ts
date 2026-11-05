// Règles de calcul d'une tontine (cagnotte, durée, calendrier).
import { addDays, addMonths, addWeeks, getISODay, setDate } from 'date-fns';
import type { Frequency } from '@/types';

/** Cagnotte d'un tour = cotisation × nombre de membres. */
export function computePot(contributionAmount: number, memberCount: number): number {
  if (!Number.isFinite(contributionAmount) || !Number.isFinite(memberCount)) return 0;
  if (contributionAmount <= 0 || memberCount <= 0) return 0;
  return Math.round(contributionAmount) * Math.round(memberCount);
}

/** Durée d'un cycle : un tour par membre. « 10 mois », « 8 semaines », « 20 semaines ». */
export function formatCycleDuration(frequency: Frequency, rounds: number): string {
  if (rounds <= 0) return '—';
  if (frequency === 'monthly') return `${rounds} mois`;
  const weeks = frequency === 'weekly' ? rounds : rounds * 2;
  return `${weeks} semaine${weeks > 1 ? 's' : ''}`;
}

/** Date d'ouverture du tour d'index `index` (0 pour le premier). */
export function roundOpenDate(start: Date, frequency: Frequency, index: number): Date {
  if (frequency === 'monthly') return addMonths(start, index);
  return addWeeks(start, frequency === 'weekly' ? index : index * 2);
}

/**
 * Date limite d'un tour.
 * Mensuel : `dueDay` est le jour du mois (1 à 28).
 * Hebdomadaire et quinzaine : `dueDay` est le jour de la semaine (1 = lundi … 7 = dimanche).
 */
export function computeDueDate(openDate: Date, frequency: Frequency, dueDay: number): Date {
  if (frequency === 'monthly') {
    const sameMonth = setDate(openDate, dueDay);
    return sameMonth < openDate ? addMonths(sameMonth, 1) : sameMonth;
  }
  const diff = (dueDay - getISODay(openDate) + 7) % 7;
  return addDays(openDate, diff);
}

export function maxDueDay(frequency: Frequency): number {
  return frequency === 'monthly' ? 28 : 7;
}

/**
 * Frais du service de paiement (PayTech) payés par le membre : pourcentage du montant,
 * arrondi au franc supérieur. Le pourcentage vient des paramètres de la plateforme
 * (payment.feePercent) ; c'est le serveur qui fait foi.
 */
export function serviceFee(amount: number, feePercent: number): number {
  if (amount <= 0 || feePercent <= 0) return 0;
  return Math.ceil((amount * feePercent) / 100);
}
