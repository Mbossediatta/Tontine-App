import { weekdayName } from '@/lib/format';
import { maxDueDay } from '@/lib/tontine';
import type { SelectOption } from '@/components/ui';
import type { Frequency } from '@/types';

/** Convertit la saisie d'un champ numérique : vide → undefined. */
export function toOptionalNumber(value: unknown): number | undefined {
  if (value === '' || value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** Rythme de cotisation, choisi par l'admin du groupe. */
export const FREQUENCY_OPTIONS: SelectOption[] = [
  { value: 'daily', label: 'Journalière (chaque jour)' },
  { value: 'weekly', label: 'Hebdomadaire (chaque semaine)' },
  { value: 'biweekly', label: 'Toutes les deux semaines (quinzaine)' },
  { value: 'monthly', label: 'Mensuelle (chaque mois)' },
];

/** Unité de la durée d'un tour selon le rythme : « jours », « semaines »… */
export const TURN_UNIT: Record<Frequency, string> = {
  daily: 'jours',
  weekly: 'semaines',
  biweekly: 'quinzaines',
  monthly: 'mois',
};

/** Montant par période : « par jour », « par semaine »… */
export const PER_PERIOD: Record<Frequency, string> = {
  daily: 'par jour',
  weekly: 'par semaine',
  biweekly: 'par quinzaine',
  monthly: 'par mois',
};

/** Jours limites possibles : jour du mois (mensuel), jour de la semaine, aucun (journalier). */
export function dueDayOptions(frequency: Frequency): SelectOption[] {
  return Array.from({ length: maxDueDay(frequency) }, (_, i) => {
    const day = i + 1;
    return {
      value: String(day),
      label: frequency === 'monthly' ? `Le ${day} du mois` : `Le ${weekdayName(day)}`,
    };
  });
}
