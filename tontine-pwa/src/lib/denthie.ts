// Règles d'affichage du Denthie (« garderie ») : épargne gardée puis répartie à la fin.
// Mêmes calculs que private.denthie_saved (migration …_denthie.sql).
import type { Group, GroupOverview, Payment, Round } from '@/types';

/** Nom affiché du type de groupe : « Denthie » (wolof) ou « Tontine ». */
export const DENTHIE_LABEL = 'Denthie';

export function isDenthie(group: Pick<Group, 'kind'> | undefined): boolean {
  return group?.kind === 'denthie';
}

/** Le carnet électronique s'ouvre une fois les frais d'adhésion payés (ou s'il n'y en a pas). */
export function bookUnlocked(overview: Pick<GroupOverview, 'myMembershipFeeDue'>): boolean {
  return overview.myMembershipFeeDue === 0;
}

/** Périodes d'épargne (pas la répartition ni les retraits d'urgence). */
export function isPeriod(round: Pick<Round, 'purpose'>): boolean {
  return (round.purpose ?? 'turn') === 'turn';
}

/** Tour de versement d'un Denthie : répartition finale ou retrait d'urgence. */
export function isDenthiePayout(round: Pick<Round, 'purpose'>): boolean {
  return round.purpose === 'distribution' || round.purpose === 'withdrawal';
}

export interface DenthieSavings {
  /** Épargne de toutes les personnes visibles (toutes pour un gestionnaire). */
  total: number;
  /** Épargne par personne (id du compte). */
  byUser: Record<string, number>;
  /** Périodes ouvertes depuis le démarrage (closes ou en cours). */
  periodCount: number;
  /** Numéro (1, 2…) de la période en cours, s'il y en a une. */
  currentPeriod?: number;
  /** Répartition finale (en attente, validée ou envoyée). */
  distribution?: Round;
}

/**
 * Épargne d'un Denthie, d'après les paiements lisibles : cotisations réussies sur les
 * périodes du cycle en cours (frais d'adhésion, pénalités et frais de paiement exclus).
 */
export function denthieSavings(cycleRounds: Round[], payments: Payment[]): DenthieSavings {
  const periods = cycleRounds.filter(isPeriod).sort((a, b) => a.number - b.number);
  const ids = new Set(periods.map((round) => round.id));
  const byUser: Record<string, number> = {};
  for (const payment of payments) {
    if (payment.status !== 'paid' || !ids.has(payment.roundId)) continue;
    byUser[payment.userId] = (byUser[payment.userId] ?? 0) + (payment.contributionAmount ?? 0);
  }
  const currentIndex = periods.findIndex(
    (round) => round.status === 'open' || round.status === 'ready_for_payout',
  );
  return {
    total: Object.values(byUser).reduce((sum, amount) => sum + amount, 0),
    byUser,
    periodCount: periods.length,
    currentPeriod: currentIndex >= 0 ? currentIndex + 1 : undefined,
    distribution: cycleRounds.find((round) => round.purpose === 'distribution'),
  };
}

/** Numéro de période d'un tour de Denthie (1 pour la première), parmi les périodes du cycle. */
export function periodNumber(round: Round, cycleRounds: Round[]): number {
  return (
    cycleRounds
      .filter((item) => isPeriod(item) && item.cycle === round.cycle)
      .sort((a, b) => a.number - b.number)
      .findIndex((item) => item.id === round.id) + 1
  );
}
