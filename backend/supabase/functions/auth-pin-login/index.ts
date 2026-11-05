// Connexion ou déverrouillage par PIN ; ouvre la session si le PIN est correct.
import { openSession, profileByPhone } from '../_shared/db.ts';
import { AppError, clientIp, phoneField, readJson, serve, stringField } from '../_shared/http.ts';
import { checkPin } from '../_shared/pin.ts';

serve(async (req) => {
  const body = await readJson(req);
  const phone = phoneField(body);
  const pin = stringField(body, 'pin');
  const profile = await profileByPhone(phone);
  // Message générique : ne pas dire si le numéro a un compte.
  if (!profile) throw new AppError('PIN incorrect.');
  const ip = clientIp(req);
  await checkPin(profile, pin, ip);
  return openSession(profile, ip);
});
