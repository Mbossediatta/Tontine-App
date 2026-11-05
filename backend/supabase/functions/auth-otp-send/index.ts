// Envoie un code de connexion à 6 chiffres par SMS (Orange). Un compte bloqué ne reçoit rien.
// Inscription sur invitation : un numéro sans compte ne reçoit un code qu'avec le code
// d'invitation d'un groupe qui accepte encore des demandes (pas encore démarré), ou à la
// demande du super admin connecté (changement de numéro : le code part au nouveau numéro).
import { otpHash, randomOtp } from '../_shared/crypto.ts';
import { admin, caller, check, profileByPhone, securitySettings } from '../_shared/db.ts';
import { AppError, clientIp, phoneField, readJson, serve, TOO_MANY } from '../_shared/http.ts';
import { sendSms } from '../_shared/orange-sms.ts';

const MESSAGES = {
  fr: (code: string, minutes: number) =>
    `Calebasse de l’Espoir : votre code est ${code}. Il expire dans ${minutes} minutes. Ne le communiquez à personne.`,
  // À relire par un locuteur wolof (point ouvert du cahier).
  wo: (code: string, minutes: number) =>
    `Calebasse de l’Espoir : sa code mooy ${code}. Dina jeex ci ${minutes} simili. Bul ko wax kenn.`,
};

const NOT_REGISTERED =
  'Ce numéro n’est pas encore inscrit. Contactez votre administrateur pour être ajouté, ou ouvrez le lien d’invitation de votre groupe.';

/** Code d'invitation d'un groupe qui accepte encore des demandes d'adhésion. */
async function validInvite(value: unknown): Promise<boolean> {
  if (typeof value !== 'string') return false;
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(code)) return false;
  const group = check(
    await admin()
      .from('groups')
      .select('id')
      .eq('invite_code', code)
      .eq('status', 'draft')
      .maybeSingle(),
  );
  return group !== null;
}

/** Vrai si la requête vient du super admin connecté (sinon : visiteur, ou autre compte). */
async function bySuperAdmin(req: Request): Promise<boolean> {
  try {
    return (await caller(req)).global_role === 'super_admin';
  } catch {
    return false;
  }
}

serve(async (req) => {
  const body = await readJson(req);
  const phone = phoneField(body);
  const profile = await profileByPhone(phone);
  if (!profile && !(await validInvite(body.inviteCode)) && !(await bySuperAdmin(req))) {
    throw new AppError(NOT_REGISTERED, 'not_found');
  }
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
