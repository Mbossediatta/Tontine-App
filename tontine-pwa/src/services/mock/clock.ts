// Événements liés au temps qui passe (confirmations de paiement, dates limites).
// En mode simulé, ils sont appliqués à chaque lecture ; le backend utilisera des tâches planifiées.
import { subDays } from 'date-fns';
import { ServiceError } from '@/lib/errors';
import { assertCanManage, requireGroup, requireRound } from './access';
import { currentUser, delay, persist } from './db';
import { applyPendingConfirmations } from './gateway';
import { denthieTick } from './denthie';
import { applyLatePenalties } from './lifecycle';

export function synchronize(now: number = Date.now()): void {
  applyPendingConfirmations(now);
  const penalties = applyLatePenalties(new Date(now));
  // Denthie : périodes échues closes, période suivante ouverte (tâche planifiée du serveur).
  if (denthieTick(new Date(now)) || penalties) persist();
}

/** Démonstration : fait comme si la date limite du tour était passée (pénalités d'office). */
export async function simulateDeadlinePassed(roundId: string): Promise<void> {
  await delay();
  const round = requireRound(roundId);
  assertCanManage(requireGroup(round.groupId), currentUser());
  if (round.status !== 'open') throw new ServiceError('Ce tour n’est plus ouvert.');
  round.dueDate = subDays(new Date(), 1).toISOString();
  applyLatePenalties();
  persist();
}
