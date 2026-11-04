import { SEEDED_USER_IDS } from './users';
import type { PinRecord } from './index';
import { hashPin } from './pinHash';

/** PIN de tous les comptes de démonstration (affiché sur l'écran de connexion en mode simulé). */
export const DEMO_PIN = '1234';

/** Chaque compte de démonstration a déjà créé son PIN. */
export function seedPins(): Record<string, PinRecord> {
  return Object.fromEntries(
    SEEDED_USER_IDS.map((userId) => [
      userId,
      { hash: hashPin(userId, DEMO_PIN), failedAttempts: 0, mustReset: false },
    ]),
  );
}
