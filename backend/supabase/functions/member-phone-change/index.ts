// Le super admin change le numéro d'une personne : le code SMS reçu sur le NOUVEAU numéro
// (envoyé par auth-otp-send à sa demande) prouve que ce numéro est bien à elle.
import { otpHash } from '../_shared/crypto.ts';
import { admin, check, checkBusiness, recordSecurityEvent, superAdminCaller } from '../_shared/db.ts';
import { AppError, clientIp, phoneField, readJson, serve, stringField } from '../_shared/http.ts';

const ERRORS: Record<string, string> = {
  none: 'Aucun code en cours pour ce numéro. Envoyez-en un nouveau.',
  expired: 'Ce code a expiré. Envoyez-en un nouveau.',
  too_many: 'Trop d’essais. Envoyez un nouveau code.',
  invalid: 'Code incorrect. Vérifiez le SMS reçu et réessayez.',
};

serve(async (req) => {
  const actor = await superAdminCaller(req, 'Changement de numéro refusé (pas super administrateur)');
  const body = await readJson(req);
  const userId = stringField(body, 'userId');
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
      detail: `Code SMS refusé (changement de numéro) · ${ERRORS[result] ?? result}`,
      phone,
      userId: actor.id,
      ip: clientIp(req),
    });
    throw new AppError(ERRORS[result] ?? ERRORS.invalid);
  }

  checkBusiness(
    await admin().rpc('svc_phone_change', { p_actor: actor.id, p_user: userId, p_phone: phone }),
  );
  return { ok: true };
});
