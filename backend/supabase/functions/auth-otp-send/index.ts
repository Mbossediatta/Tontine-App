// Envoie un code de connexion à 6 chiffres par SMS (Orange).
// Répond pareil que le numéro ait un compte ou non ; un compte bloqué ne reçoit rien.
import { otpHash, randomOtp } from '../_shared/crypto.ts';
import { admin, check, profileByPhone, securitySettings } from '../_shared/db.ts';
import { clientIp, phoneField, readJson, serve, TOO_MANY } from '../_shared/http.ts';
import { sendSms } from '../_shared/orange-sms.ts';

const MESSAGES = {
  fr: (code: string, minutes: number) =>
    `Calebasse de l’Espoir : votre code est ${code}. Il expire dans ${minutes} minutes. Ne le communiquez à personne.`,
  // À relire par un locuteur wolof (point ouvert du cahier).
  wo: (code: string, minutes: number) =>
    `Calebasse de l’Espoir : sa code mooy ${code}. Dina jeex ci ${minutes} simili. Bul ko wax kenn.`,
};

serve(async (req) => {
  const phone = phoneField(await readJson(req));
  const profile = await profileByPhone(phone);
  const { otpValidityMinutes } = await securitySettings();
  const code = randomOtp();

  const status = check(
    await admin().rpc('svc_otp_issue', {
      p_phone: phone,
      p_code_hash: await otpHash(phone, code),
      p_ip: clientIp(req),
      p_validity_minutes: otpValidityMinutes,
    }),
  ) as string;
  if (status !== 'ok') throw TOO_MANY('Trop de codes demandés. Réessayez dans une heure.');

  const message = MESSAGES[profile?.language ?? 'fr'](code, otpValidityMinutes);
  await sendSms(phone, message, 'otp', profile?.id);
  return { ok: true };
});
