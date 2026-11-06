import type { GroupOverview } from '@/types';
import { installmentOf, periodsLabel, periodsLeft } from './installments';

/** 100 FCFA par jour, il reste 6 jours (600), pénalité 500, frais de paiement 1,5 %. */
const overview = {
  myAmountDue: 1100,
  myPenalty: 500,
  myMembershipFeeDue: 0,
  myPeriodAmount: 100,
  feePercent: 1.5,
} as GroupOverview;

describe('versements', () => {
  it('compte les jours restants', () => {
    expect(periodsLeft(overview)).toBe(6);
    expect(periodsLabel('daily', 1)).toBe('1 jour');
    expect(periodsLabel('weekly', 3)).toBe('3 semaines');
  });

  it('un versement partiel ne porte pas la pénalité, le dernier si', () => {
    expect(installmentOf(overview, 2)).toMatchObject({ contribution: 200, penalty: 0, total: 203 });
    expect(installmentOf(overview, null)).toMatchObject({
      contribution: 600,
      penalty: 500,
      serviceFee: 17,
      total: 1117,
    });
  });
});
