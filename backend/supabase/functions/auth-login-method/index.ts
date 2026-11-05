// Connexion sur ordinateur : « pin » si le numéro a un PIN utilisable, sinon « otp ».
// Ne révèle ni le nom ni aucune autre donnée du compte.
import { admin, check, profileByPhone } from '../_shared/db.ts';
import { phoneField, readJson, serve } from '../_shared/http.ts';

serve(async (req) => {
  const phone = phoneField(await readJson(req));
  const profile = await profileByPhone(phone);
  if (!profile) return { method: 'otp' };
  const usable = check(await admin().rpc('svc_pin_usable', { p_user: profile.id })) as boolean;
  return { method: usable ? 'pin' : 'otp' };
});
