import { computeDueDate, computePot, formatCycleDuration, roundOpenDate } from './tontine';

describe('computePot', () => {
  it('multiplie la cotisation par le nombre de membres', () => {
    expect(computePot(4500, 10)).toBe(45000);
    expect(computePot(10000, 6)).toBe(60000);
    expect(computePot(2000, 8)).toBe(16000);
  });

  it('renvoie 0 pour des valeurs absentes ou invalides', () => {
    expect(computePot(0, 10)).toBe(0);
    expect(computePot(4500, 0)).toBe(0);
    expect(computePot(Number.NaN, 10)).toBe(0);
    expect(computePot(-500, 10)).toBe(0);
  });
});

describe('formatCycleDuration', () => {
  it('annonce un tour par membre', () => {
    expect(formatCycleDuration('monthly', 10)).toBe('10 mois');
    expect(formatCycleDuration('weekly', 8)).toBe('8 semaines');
    expect(formatCycleDuration('biweekly', 5)).toBe('10 semaines');
    expect(formatCycleDuration('weekly', 1)).toBe('1 semaine');
  });
});

describe('calendrier', () => {
  const start = new Date(2026, 0, 1); // jeudi 1er janvier 2026

  it('ouvre les tours selon la fréquence', () => {
    expect(roundOpenDate(start, 'monthly', 2)).toEqual(new Date(2026, 2, 1));
    expect(roundOpenDate(start, 'weekly', 1)).toEqual(new Date(2026, 0, 8));
    expect(roundOpenDate(start, 'biweekly', 1)).toEqual(new Date(2026, 0, 15));
  });

  it('calcule la date limite mensuelle', () => {
    expect(computeDueDate(new Date(2026, 0, 1), 'monthly', 10)).toEqual(new Date(2026, 0, 10));
    expect(computeDueDate(new Date(2026, 0, 15), 'monthly', 10)).toEqual(new Date(2026, 1, 10));
  });

  it('calcule la date limite hebdomadaire (jour de la semaine)', () => {
    // Prochain lundi après le jeudi 1er janvier : le 5.
    expect(computeDueDate(start, 'weekly', 1)).toEqual(new Date(2026, 0, 5));
    // Le jeudi lui-même.
    expect(computeDueDate(start, 'weekly', 4)).toEqual(start);
  });
});
