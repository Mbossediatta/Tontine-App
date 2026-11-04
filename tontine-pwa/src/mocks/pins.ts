import { DEMO_PIN } from '@/lib/demo';
import { SEEDED_USER_IDS } from './users';
import type { PinRecord } from './index';
import { hashPin } from './pinHash';

/** PIN de tous les comptes de démonstration (défini dans lib/demo, repris ici). */
export { DEMO_PIN };

/** Chaque compte de démonstration a déjà créé son PIN. */
export function seedPins(): Record<string, PinRecord> {
  return Object.fromEntries(
    SEEDED_USER_IDS.map((userId) => [
      userId,
      { hash: hashPin(userId, DEMO_PIN), failedAttempts: 0, mustReset: false },
    ]),
  );
}
