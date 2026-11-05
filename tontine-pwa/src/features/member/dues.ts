// Règles d'affichage de l'espace membre : ce que je dois payer, et quand je reçois.
import { differenceInCalendarDays, format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { monthNameIn, translate, type Language } from '@/i18n';
import type { GroupOverview, PaymentStatus, Round } from '@/types';

/** Une cotisation que je dois encore payer. */
export interface Due {
  overview: GroupOverview;
  round: Round;
  /** Total à payer : cotisation de mes parts + pénalité + frais d'adhésion éventuels. */
  amount: number;
  status: Exclude<PaymentStatus, 'paid' | 'refunded'>;
}

/** Mes groupes actifs (pas les demandes en attente). */
export function activeGroups(groups: GroupOverview[]): GroupOverview[] {
  return groups.filter((g) => g.myMembershipStatus === 'active');
}

/**
 * Cotisations à payer dans tous mes groupes, de la plus urgente à la moins urgente :
 * les retards d'abord, puis par date limite.
 */
export function duesOf(groups: GroupOverview[]): Due[] {
  const order: Record<Due['status'], number> = { late: 0, failed: 1, pending: 2 };
  return activeGroups(groups)
    .flatMap((overview): Due[] => {
      const { currentRound: round, myStatus } = overview;
      if (!round || round.status !== 'open' || !myStatus) return [];
      if (myStatus === 'paid' || myStatus === 'refunded') return [];
      return [
        {
          overview,
          round,
          amount: overview.myAmountDue,
          status: myStatus,
        },
      ];
    })
    .sort(
      (a, b) => order[a.status] - order[b.status] || a.round.dueDate.localeCompare(b.round.dueDate),
    );
}

/** « Dans 6 jours », « Demain », « Aujourd'hui », « En retard de 3 jours » (ou en wolof). */
export function deadlineLabel(
  dueDate: string,
  now: Date = new Date(),
  language: Language = 'fr',
): string {
  const days = differenceInCalendarDays(new Date(dueDate), now);
  if (days > 1) return translate(language, 'deadline.inDays', { count: days });
  if (days === 1) return translate(language, 'deadline.tomorrow');
  if (days === 0) return translate(language, 'deadline.today');
  const late = -days;
  return late > 1
    ? translate(language, 'deadline.lateMany', { count: late })
    : translate(language, 'deadline.lateOne');
}

/** « novembre » */
export function monthName(iso: string): string {
  return format(new Date(iso), 'MMMM', { locale: fr });
}

/** « 5 nov. » */
export function shortDate(iso: string): string {
  return format(new Date(iso), 'd MMM', { locale: fr });
}

/**
 * Nom d'une période de cotisation : « Cotisation de novembre » pour une tontine
 * mensuelle, « Tour 3 » sinon (plusieurs tours peuvent tomber le même mois).
 */
export function periodLabel(
  overview: GroupOverview,
  round: Round,
  language: Language = 'fr',
): string {
  return overview.group.frequency === 'monthly' && overview.group.turnLength === 1
    ? translate(language, 'period.month', { month: monthNameIn(language, round.dueDate) })
    : translate(language, 'period.round', { number: round.number });
}

/** Ce que je recevrai à mon tour : ma part si le tour a plusieurs bénéficiaires. */
export function myPayoutAmount(round: Round, userId: string): number {
  return round.beneficiaryAmounts?.[userId] ?? round.potAmount;
}
