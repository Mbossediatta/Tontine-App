// Codes de vérification par SMS (simulés ; le backend appliquera les mêmes règles).
import { ServiceError } from '@/lib/errors';
import { db } from './db';
import { sendSms } from './sms';
import { smsService } from '../smsProvider';

/** Essais permis sur un même code avant d'en exiger un nouveau. */
const MAX_ATTEMPTS = 5;

interface PendingCode {
  code: string;
  expiresAt: number;
  attempts: number;
}

/**
 * Codes en attente, par numéro. Gardés en mémoire seulement : après un rechargement
 * de la page, il suffit de demander un nouveau code. Le backend, lui, ne gardera
 * qu'une empreinte du code, jamais le code en clair.
 */
const pending = new Map<string, PendingCode>();

/** 6 chiffres tirés au hasard par le générateur cryptographique du navigateur. */
function randomCode(): string {
  const [value = 0] = crypto.getRandomValues(new Uint32Array(1));
  return String(value % 1_000_000).padStart(6, '0');
}

/** Crée un code pour ce numéro et l'envoie par SMS (il remplace le précédent). */
export async function issueOtp(phone: string): Promise<void> {
  const minutes = db.settings.security.otpValidityMinutes;
  const code = randomCode();
  pending.set(phone, { code, expiresAt: Date.now() + minutes * 60_000, attempts: 0 });
  sendSms(phone, 'otp'); // journal des SMS (suivi des coûts)
  await smsService.send(
    phone,
    `Calebasse de l’Espoir : votre code est ${code}. Il expire dans ${minutes} minutes. Ne le communiquez à personne.`,
  );
}

/** Vérifie le code saisi ; le code ne sert qu'une fois. Lève une erreur claire sinon. */
export function checkOtp(phone: string, code: string): void {
  const entry = pending.get(phone);
  if (!entry) throw new ServiceError('Aucun code en cours pour ce numéro. Demandez-en un nouveau.');
  if (Date.now() > entry.expiresAt) {
    pending.delete(phone);
    throw new ServiceError('Ce code a expiré. Demandez-en un nouveau.');
  }
  if (entry.code !== code) {
    entry.attempts += 1;
    if (entry.attempts >= MAX_ATTEMPTS) {
      pending.delete(phone);
      throw new ServiceError('Trop d’essais. Demandez un nouveau code.');
    }
    throw new ServiceError('Code incorrect. Vérifiez le SMS reçu et réessayez.');
  }
  pending.delete(phone);
}

/** Tests et démonstration uniquement : dernier code envoyé à ce numéro. */
export function lastOtpFor(phone: string): string | undefined {
  return pending.get(phone)?.code;
}
