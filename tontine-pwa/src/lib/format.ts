import {
  format,
  formatDistanceToNowStrict,
  isToday,
  isTomorrow,
  isYesterday,
  parseISO,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import type { Frequency, Group, PaymentMethod } from '@/types';

const amountFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

/** « 45 000 FCFA » */
export function formatAmount(value: number): string {
  return `${amountFormatter.format(Math.round(value))} FCFA`;
}

function toDate(value: string | Date): Date {
  return typeof value === 'string' ? parseISO(value) : value;
}

/** « 5 nov. 2026 » */
export function formatDate(value: string | Date): string {
  return format(toDate(value), 'd MMM yyyy', { locale: fr });
}

/** « 5 nov. 2026 à 14:30 » */
export function formatDateTime(value: string | Date): string {
  return format(toDate(value), "d MMM yyyy 'à' HH:mm", { locale: fr });
}

/** « aujourd’hui », « demain », « dans 3 jours », « il y a 2 jours » */
export function formatRelative(value: string | Date, now: Date = new Date()): string {
  const date = toDate(value);
  if (isToday(date)) return 'aujourd’hui';
  if (isTomorrow(date)) return 'demain';
  return formatDistanceToNowStrict(date, {
    addSuffix: true,
    locale: fr,
    roundingMethod: date > now ? 'ceil' : 'floor',
  });
}

/** Garde uniquement les 9 chiffres d'un numéro sénégalais (sans l'indicatif). */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.startsWith('221') && digits.length === 12 ? digits.slice(3) : digits;
}

/** « 77 123 45 67 » */
export function formatPhoneLocal(raw: string): string {
  const d = normalizePhone(raw).slice(0, 9);
  return [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean).join(' ');
}

/** « +221 77 123 45 67 » */
export function formatPhone(raw: string): string {
  return `+221 ${formatPhoneLocal(raw)}`;
}

export function fullName(user: { firstName: string; lastName: string }): string {
  return `${user.firstName} ${user.lastName}`;
}

const FREQUENCY_LABELS: Record<Frequency, string> = {
  daily: 'Journalière',
  weekly: 'Hebdomadaire',
  biweekly: 'Toutes les deux semaines',
  monthly: 'Mensuelle',
};

const FREQUENCY_PER: Record<Frequency, string> = {
  daily: 'par jour',
  weekly: 'par semaine',
  biweekly: 'par quinzaine',
  monthly: 'par mois',
};

export function frequencyLabel(frequency: Frequency): string {
  return FREQUENCY_LABELS[frequency];
}

/** « 4 500 FCFA par mois » */
export function contributionLabel(amount: number, frequency: Frequency): string {
  return `${formatAmount(amount)} ${FREQUENCY_PER[frequency]}`;
}

/** « 1 000 FCFA par jour et par part » */
export function groupContributionLabel(group: Pick<Group, 'contributionAmount' | 'frequency'>) {
  return `${contributionLabel(group.contributionAmount, group.frequency)} et par part`;
}

const METHOD_LABELS: Record<PaymentMethod, string> = {
  wave: 'Wave',
  orange_money: 'Orange Money',
  free_money: 'Free Money',
  cash: 'Espèces',
};

export function paymentMethodLabel(method: PaymentMethod): string {
  return METHOD_LABELS[method];
}

const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

/** Libellé du jour limite : « le 10 du mois » ou « le lundi ». */
export function dueDayLabel(frequency: Frequency, day: number): string {
  if (frequency === 'daily') return 'le dernier jour du tour';
  if (frequency === 'monthly') return `le ${day} du mois`;
  return `le ${WEEKDAYS[day - 1] ?? '—'}`;
}

export function weekdayName(day: number): string {
  return WEEKDAYS[day - 1] ?? '';
}

export function initials(user: { firstName: string; lastName: string }): string {
  return `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase();
}

/** « 1 groupe », « 3 groupes » : accorde le nom avec le nombre (pluriel régulier par défaut). */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}

/** « novembre 2026 » */
export function formatMonth(value: string | Date): string {
  return format(toDate(value), 'MMMM yyyy', { locale: fr });
}

/** « Aujourd’hui · 09:42 », « Hier · 17:15 », sinon « 01 nov. · 16:20 » (journal, transactions). */
export function formatMoment(value: string | Date): string {
  const date = toDate(value);
  const time = format(date, 'HH:mm');
  if (isToday(date)) return `Aujourd’hui · ${time}`;
  if (isYesterday(date)) return `Hier · ${time}`;
  return `${format(date, 'dd MMM', { locale: fr })} · ${time}`;
}

/** Texte comparable pour une recherche : sans accents ni majuscules (« Aïssatou » → « aissatou »). */
export function searchable(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
