// Vérification d'un PIN, commune à la connexion et au changement de PIN.
import { verifyPin } from './crypto.ts';
import { admin, check, recordSecurityEvent, securitySettings, type Profile } from './db.ts';
import { AppError, TOO_MANY } from './http.ts';

/** Échecs de PIN tolérés par adresse IP et par heure (même PIN essayé sur plusieurs comptes). */
const MAX_FAILURES_PER_IP = 20;

const plural = (n: number) => (n > 1 ? 's' : '');

/**
 * Vérifie le PIN. L'essai est réservé avant le calcul (aucun essai « gratuit » en
 * parallèle) ; au dernier essai raté, le PIN est bloqué et seul un code SMS le débloque.
 */
export async function checkPin(profile: Profile, pin: string, ip: string | null): Promise<void> {
  if (ip) {
    const failures = check(await admin().rpc('svc_recent_pin_failures', { p_ip: ip })) as number;
    if (failures >= MAX_FAILURES_PER_IP) throw TOO_MANY();
  }
  const { maxPinAttempts } = await securitySettings();
  const rows = check(
    await admin().rpc('svc_pin_begin_attempt', { p_user: profile.id, p_max_attempts: maxPinAttempts }),
  ) as { pin_hash: string; attempt: number }[];
  const attempt = rows[0];
  if (!attempt) {
    throw new AppError('Créez d’abord votre PIN : recevez un code par SMS.', 'conflict');
  }

  const ok = /^[0-9]{4}$/.test(pin) && (await verifyPin(profile.id, pin, attempt.pin_hash));
  const left = check(
    await admin().rpc('svc_pin_finish_attempt', {
      p_user: profile.id, p_success: ok, p_max_attempts: maxPinAttempts,
    }),
  ) as number;
  if (ok) return;

  if (left <= 0) {
    await recordSecurityEvent({
      kind: 'pin_blocked', severity: 'critical', detail: 'PIN bloqué après trop d’essais', userId: profile.id, ip,
    });
    throw new AppError(
      `PIN bloqué après ${maxPinAttempts} essais. Recevez un code par SMS pour en créer un nouveau.`,
      'forbidden',
    );
  }
  await recordSecurityEvent({
    kind: 'pin_failed', severity: 'warning', detail: `PIN incorrect (${attempt.attempt}e essai)`, userId: profile.id, ip,
  });
  throw new AppError(`PIN incorrect. Il vous reste ${left} essai${plural(left)}.`);
}
