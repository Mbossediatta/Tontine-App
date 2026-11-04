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

export const FREQUENCY_OPTIONS: SelectOption[] = [
  { value: 'weekly', label: 'Hebdomadaire' },
  { value: 'biweekly', label: 'Toutes les deux semaines (quinzaine)' },
  { value: 'monthly', label: 'Mensuelle' },
];

/** Jours limites possibles : jour du mois (mensuel) ou jour de la semaine. */
export function dueDayOptions(frequency: Frequency): SelectOption[] {
  return Array.from({ length: maxDueDay(frequency) }, (_, i) => {
    const day = i + 1;
    return {
      value: String(day),
      label: frequency === 'monthly' ? `Le ${day} du mois` : `Le ${weekdayName(day)}`,
    };
  });
}
