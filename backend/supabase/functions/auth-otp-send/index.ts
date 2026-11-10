// Envoie un code de connexion à 6 chiffres par SMS (Orange). Un compte bloqué ne reçoit rien.
// Inscription sur invitation : un numéro sans compte ne reçoit un code qu'avec le code
// d'invitation d'un groupe qui accepte encore des demandes (pas encore démarré) ou d'une
// structure active d'une organisation (ex. AFP), ou à la demande du super admin connecté
// (changement de numéro : le code part au nouveau numéro).
// L'appli d'une organisation envoie son adresse (`org`) : le SMS porte alors son sigle.
import { otpHash, randomOtp } from '../_shared/crypto.ts';
import { admin, caller, check, profileByPhone, securitySettings } from '../_shared/db.ts';
import { AppError, clientIp, phoneField, readJson, serve, TOO_MANY } from '../_shared/http.ts';
import { orgSender, sendSms } from '../_shared/orange-sms.ts';

const BRAND = 'Calebasse de l’Espoir';

const MESSAGES = {
  fr: (brand: string, code: string, minutes: number) =>
    `${brand} : votre code est ${code}. Il expire dans ${minutes} minutes. Ne le communiquez à personne.`,
  // À relire par un locuteur wolof (point ouvert du cahier).
  wo: (brand: string, code: string, minutes: number) =>
    `${brand} : sa code mooy ${code}. Dina jeex ci ${minutes} simili. Bul ko wax kenn.`,
};

const NOT_REGISTERED =
  'Ce numéro n’est pas encore inscrit. Contactez votre administrateur pour être ajouté, ou ouvrez le lien d’invitation de votre groupe.';
const NOT_REGISTERED_ORG =
  'Ce numéro n’est pas encore inscrit. Ouvrez le lien d’invitation de votre structure, ou contactez son responsable.';

/** Code d'invitation d'un groupe qui accepte encore des demandes, ou d'une structure active. */
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
  if (group !== null) return true;
  return check(await admin().rpc('svc_structure_invite_valid', { p_code: code })) === true;
}

/**
 * Depuis l'appli d'une organisation : texte « AFP – Calebasse de l’Espoir » et signature
 * de l'organisation si elle est configurée (ORANGE_SIGNATURE_AFP).
 */
async function brandFor(value: unknown): Promise<{ brand: string; sender?: string }> {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{1,29}$/.test(value)) return { brand: BRAND };
  const org = check(
    await admin()
      .from('organizations')
      .select('short_name')
      .eq('slug', value)
      .eq('is_suspended', false)
      .maybeSingle(),
  ) as { short_name: string } | null;
  if (!org) return { brand: BRAND };
  return { brand: `${org.short_name} – ${BRAND}`, sender: orgSender(org.short_name) };
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
    throw new AppError(body.org ? NOT_REGISTERED_ORG : NOT_REGISTERED, 'not_found');
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

  const { brand, sender } = await brandFor(body.org);
  const message = MESSAGES[profile?.language ?? 'fr'](brand, code, otpValidityMinutes);
  await sendSms(phone, message, 'otp', profile?.id, sender);
  return { ok: true };
});
