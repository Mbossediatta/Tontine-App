// Vérifie le code SMS. Succès : renvoie ce qu'il faut pour l'étape suivante (profil ou PIN)
// et un jeton de preuve du numéro, valable 10 minutes. La session n'est pas encore ouverte.
import { otpHash, signProof } from '../_shared/crypto.ts';
import { admin, check, profileByPhone, recordSecurityEvent } from '../_shared/db.ts';
import { AppError, clientIp, phoneField, readJson, serve, stringField } from '../_shared/http.ts';

const ERRORS: Record<string, string> = {
  none: 'Aucun code en cours pour ce numéro. Demandez-en un nouveau.',
  expired: 'Ce code a expiré. Demandez-en un nouveau.',
  too_many: 'Trop d’essais. Demandez un nouveau code.',
  invalid: 'Code incorrect. Vérifiez le SMS reçu et réessayez.',
};

serve(async (req) => {
  const body = await readJson(req);
  const phone = phoneField(body);
  const code = stringField(body, 'code');
  if (!/^[0-9]{6}$/.test(code)) throw new AppError('Saisissez les 6 chiffres du code.');

  const result = check(
    await admin().rpc('svc_otp_check', { p_phone: phone, p_code_hash: await otpHash(phone, code) }),
  ) as string;
  if (result !== 'ok') {
    await recordSecurityEvent({
      kind: 'otp_failed',
      severity: result === 'too_many' ? 'warning' : 'info',
      detail: `Code SMS refusé · ${ERRORS[result] ?? result}`,
      phone,
      ip: clientIp(req),
    });
    throw new AppError(ERRORS[result] ?? ERRORS.invalid);
  }

  const profile = await profileByPhone(phone);
  const hasPin = profile
    ? (check(await admin().rpc('svc_pin_usable', { p_user: profile.id })) as boolean)
    : false;
  // Version des conditions à accepter sur l'écran du PIN (null : déjà acceptées).
  const termsVersion = profile
    ? (check(await admin().rpc('svc_terms_due', { p_user: profile.id })) as number | null)
    : (check(await admin().rpc('legal_terms')) as { version: number }).version;
  return {
    isNewAccount: !profile,
    termsVersion,
    firstName: profile?.first_name,
    hasPin,
    proofToken: await signProof(phone),
  };
});
