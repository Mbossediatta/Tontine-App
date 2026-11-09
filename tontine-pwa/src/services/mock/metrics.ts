// Indicateurs financiers partagés par les tableaux de bord (administrateur et super administrateur).
// Règle commune : un tour « attend » la cotisation de chaque membre actif, plus les pénalités
// appliquées ; il a « collecté » la somme des paiements réussis. Un tour à venir n'attend rien.
import { isSameMonth, startOfMonth, subMonths } from 'date-fns';
import { contributionPerTurn } from '@/lib/tontine';
import type { MonthlyCollection, Round } from '@/types';
import { activeMemberships } from './access';
import { db } from './db';

/** Montant attendu : cotisations de la période, frais d'adhésion dus et pénalités. */
export function roundExpected(round: Round): number {
  if (round.status === 'upcoming') return 0;
  const group = db.groups.find((g) => g.id === round.groupId);
  if (!group) return 0;
  const contributions = contributionPerTurn(group, round) * activeMemberships(group.id).length;
  const feeUsers = new Set(
    db.memberships
      .filter((membership) => membership.groupId === group.id && membership.status === 'active')
      .map((membership) => membership.userId),
  );
  const unpaidFees = [...feeUsers].filter(
    (userId) =>
      !db.platformEarnings.some(
        (earning) =>
          earning.groupId === group.id &&
          earning.userId === userId &&
          earning.kind === 'membership_fee',
      ),
  ).length;
  const fees = unpaidFees * (group.membershipFeeAmount ?? 0);
  const penalties = db.penalties
    .filter((p) => p.roundId === round.id)
    .reduce((sum, p) => sum + p.amount, 0);
  return contributions + fees + penalties;
}

/** Total encaissé pour un tour, frais d'adhésion et pénalités compris. */
export function roundCollected(round: Round): number {
  return db.payments
    .filter((p) => p.roundId === round.id && p.status === 'paid')
    .reduce((sum, p) => sum + p.amount, 0);
}

/** Cotisations encaissées pour la cagnotte, hors revenus de la plateforme. */
export function roundContributionCollected(round: Round): number {
  return db.payments
    .filter((p) => p.roundId === round.id && p.status === 'paid')
    .reduce(
      (sum, p) =>
        sum +
        (p.contributionAmount ??
          p.amount - (p.membershipFeeAmount ?? 0) - (p.latePenaltyAmount ?? 0)),
      0,
    );
}

/** Attendu et collecté cumulés sur une liste de tours. */
export function sumCollection(rounds: Round[]): { expected: number; collected: number } {
  return rounds.reduce(
    (total, round) => ({
      expected: total.expected + roundExpected(round),
      collected: total.collected + roundCollected(round),
    }),
    { expected: 0, collected: 0 },
  );
}

/** Taux de recouvrement en % (collecté ÷ attendu), ou `null` si rien n'était attendu. */
export function recoveryRate({ expected, collected }: { expected: number; collected: number }) {
  return expected > 0 ? Math.min(100, Math.round((collected / expected) * 100)) : null;
}

/**
 * Attendu et collecté mois par mois, sur les `months` derniers mois (mois en cours inclus).
 * Chaque tour est rangé dans le mois de sa date limite.
 */
export function monthlyCollections(
  rounds: Round[],
  months: number,
  now: Date = new Date(),
): MonthlyCollection[] {
  return Array.from({ length: months }, (_, i) => {
    const month = startOfMonth(subMonths(now, months - 1 - i));
    const inMonth = rounds.filter((r) => isSameMonth(new Date(r.dueDate), month));
    return { month: month.toISOString(), ...sumCollection(inMonth) };
  });
}
