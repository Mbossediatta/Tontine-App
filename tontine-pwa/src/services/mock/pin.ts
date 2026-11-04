// Règles du PIN de connexion (simulées ; le backend appliquera les mêmes).
import { ServiceError } from '@/lib/errors';
import { isWeakPin } from '@/lib/validators';
import { hashPin } from '@/mocks/pinHash';
import { db } from './db';

/** Nombre d'essais ratés avant blocage du PIN (Paramètres → Connexion et sécurité). */
const maxAttempts = () => db.settings.security.maxPinAttempts;

/** L'utilisateur doit (re)créer son PIN : jamais créé, oublié, bloqué ou réinitialisé. */
export function needsPin(userId: string): boolean {
  const record = db.pins[userId];
  return !record || record.mustReset;
}

/**
 * Vérifie un PIN. En cas d'erreur, compte l'essai raté ; au dernier autorisé, le PIN est bloqué.
 * Lève une erreur dont le message dit combien d'essais il reste.
 */
export function checkPin(userId: string, pin: string): void {
  const record = db.pins[userId];
  if (!record || record.mustReset) {
    throw new ServiceError('Créez d’abord votre PIN : recevez un code par SMS.', 'conflict');
  }
  if (record.hash === hashPin(userId, pin)) {
    record.failedAttempts = 0;
    return;
  }
  record.failedAttempts += 1;
  const left = maxAttempts() - record.failedAttempts;
  if (left <= 0) {
    record.mustReset = true;
    throw new ServiceError(
      `PIN bloqué après ${maxAttempts()} essais. Recevez un code par SMS pour en créer un nouveau.`,
      'forbidden',
    );
  }
  throw new ServiceError(`PIN incorrect. Il vous reste ${left} essai${left > 1 ? 's' : ''}.`);
}

/** Enregistre un nouveau PIN (seule son empreinte est conservée). */
export function savePin(userId: string, pin: string): void {
  if (!/^\d{4}$/.test(pin)) throw new ServiceError('Le PIN doit contenir 4 chiffres.');
  if (isWeakPin(pin)) {
    throw new ServiceError('Ce PIN est trop facile à deviner. Choisissez-en un autre.');
  }
  db.pins[userId] = { hash: hashPin(userId, pin), failedAttempts: 0, mustReset: false };
}

/** Oblige l'utilisateur à recréer son PIN (après un code SMS) à sa prochaine connexion. */
export function requirePinReset(userId: string): void {
  const record = db.pins[userId];
  if (record) record.mustReset = true;
}
