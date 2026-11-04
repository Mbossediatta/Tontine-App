// Traduction de l'interface : français (référence) et wolof (en cours).
// La langue est choisie dans le Profil et mémorisée sur l'appareil.
import { format } from 'date-fns';
import { fr as frLocale } from 'date-fns/locale';
import { create } from 'zustand';
import { formatAmount } from '@/lib/format';
import type { Frequency } from '@/types';
import { fr, type MessageKey } from './fr';
import { wo } from './wo';

export type Language = 'fr' | 'wo';
export type { MessageKey };

export const LANGUAGES: Array<{ value: Language; label: string }> = [
  { value: 'fr', label: 'Français' },
  { value: 'wo', label: 'Wolof' },
];

const MESSAGES: Record<Language, Record<MessageKey, string>> = { fr, wo };
const KEY = 'calebasse.language.v1';

function readLanguage(): Language {
  try {
    return window.localStorage.getItem(KEY) === 'wo' ? 'wo' : 'fr';
  } catch {
    return 'fr';
  }
}

/** `lang` de la page : lecteurs d'écran et correcteurs suivent la langue choisie. */
function applyToDocument(language: Language): void {
  if (typeof document !== 'undefined') document.documentElement.lang = language;
}

interface LanguageState {
  language: Language;
  setLanguage: (language: Language) => void;
}

export const useLanguageStore = create<LanguageState>((set) => ({
  language: readLanguage(),
  setLanguage: (language) => {
    try {
      window.localStorage.setItem(KEY, language);
    } catch {
      // Stockage indisponible : la langue vaut pour cette visite seulement.
    }
    applyToDocument(language);
    set({ language });
  },
}));
applyToDocument(useLanguageStore.getState().language);

export type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

/** Traduit une clé dans une langue ; {nom} est remplacé par values.nom. */
export function translate(
  language: Language,
  key: MessageKey,
  values: Record<string, string | number> = {},
): string {
  return MESSAGES[language][key].replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}

/** Langue courante et fonction de traduction, pour les composants. */
export function useT(): { t: Translate; language: Language } {
  const language = useLanguageStore((state) => state.language);
  return {
    language,
    t: (key, values) => translate(language, key, values),
  };
}

// --- Dates : date-fns n'a pas de wolof, on fournit les noms nous-mêmes. ---

const WO_MONTHS = [
  'Samwiyee',
  'Fewriyee',
  'Mars',
  'Awril',
  'Me',
  'Suwe',
  'Sulet',
  'Ut',
  'Sàttumbar',
  'Oktoobar',
  'Nowàmbar',
  'Desàmbar',
];
/** Du dimanche au samedi, comme Date.getDay(). */
const WO_DAYS = ['Dibéer', 'Altine', 'Talaata', 'Àllarba', 'Alxames', 'Àjjuma', 'Gaawu'];

/** « novembre » / « Nowàmbar » */
export function monthNameIn(language: Language, iso: string | Date): string {
  const date = new Date(iso);
  return language === 'wo'
    ? (WO_MONTHS[date.getMonth()] ?? '')
    : format(date, 'MMMM', { locale: frLocale });
}

/** « 10 nov. » / « 10 Nowàmbar » */
export function shortDateIn(language: Language, iso: string | Date): string {
  const date = new Date(iso);
  return language === 'wo'
    ? `${date.getDate()} ${WO_MONTHS[date.getMonth()] ?? ''}`
    : format(date, 'd MMM', { locale: frLocale });
}

/** « Mercredi 4 novembre » / « Àllarba 4 Nowàmbar » */
export function dayLabelIn(language: Language, iso: string | Date): string {
  const date = new Date(iso);
  if (language === 'wo') {
    return `${WO_DAYS[date.getDay()] ?? ''} ${date.getDate()} ${WO_MONTHS[date.getMonth()] ?? ''}`;
  }
  const text = format(date, 'EEEE d MMMM', { locale: frLocale });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const FREQUENCY_KEY: Record<Frequency, MessageKey> = {
  monthly: 'freq.monthly',
  biweekly: 'freq.biweekly',
  weekly: 'freq.weekly',
};

/** « 4 500 FCFA par mois » dans la langue choisie. */
export function contributionLabelIn(
  language: Language,
  amount: number,
  frequency: Frequency,
  daily = false,
): string {
  return translate(language, daily ? 'freq.daily' : FREQUENCY_KEY[frequency], {
    amount: formatAmount(amount),
  });
}
