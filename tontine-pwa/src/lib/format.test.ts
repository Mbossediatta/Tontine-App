import { addDays } from 'date-fns';
import {
  contributionLabel,
  dueDayLabel,
  formatAmount,
  formatDate,
  formatPhone,
  formatPhoneLocal,
  formatRelative,
  normalizePhone,
} from './format';

/** Intl utilise des espaces insécables comme séparateurs de milliers. */
const plain = (value: string) => value.replace(/\s/g, ' ');

describe('formatAmount', () => {
  it('formate en FCFA sans décimales', () => {
    expect(plain(formatAmount(45000))).toBe('45 000 FCFA');
    expect(plain(formatAmount(4500))).toBe('4 500 FCFA');
    expect(plain(formatAmount(500))).toBe('500 FCFA');
  });

  it('arrondit les montants non entiers', () => {
    expect(plain(formatAmount(1999.6))).toBe('2 000 FCFA');
  });

  it('affiche zéro', () => {
    expect(formatAmount(0)).toBe('0 FCFA');
  });
});

describe('formatDate', () => {
  it('utilise le format court français', () => {
    expect(formatDate('2026-11-05T10:00:00')).toBe('5 nov. 2026');
  });
});

describe('formatRelative', () => {
  it('donne un délai relatif en français', () => {
    expect(formatRelative(addDays(new Date(), 3))).toBe('dans 3 jours');
    expect(formatRelative(new Date())).toBe('aujourd’hui');
    expect(formatRelative(addDays(new Date(), 1))).toBe('demain');
  });
});

describe('téléphones', () => {
  it('formate un numéro sénégalais', () => {
    expect(formatPhone('771234567')).toBe('+221 77 123 45 67');
    expect(formatPhoneLocal('7712')).toBe('77 12');
  });

  it("retire l'indicatif et les espaces", () => {
    expect(normalizePhone('+221 77 123 45 67')).toBe('771234567');
    expect(normalizePhone('77 123 45 67')).toBe('771234567');
  });
});

describe('libellés', () => {
  it('décrit la cotisation et le jour limite', () => {
    expect(plain(contributionLabel(4500, 'monthly'))).toBe('4 500 FCFA par mois');
    expect(dueDayLabel('monthly', 10)).toBe('le 10 du mois');
    expect(dueDayLabel('weekly', 1)).toBe('le lundi');
  });
});
