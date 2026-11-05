// Change le PIN de la personne connectée : le PIN actuel est exigé (essais comptés).
import { assertPinFormat, hashPin } from '../_shared/crypto.ts';
import { admin, caller, check } from '../_shared/db.ts';
import { AppError, clientIp, readJson, serve, stringField } from '../_shared/http.ts';
import { checkPin } from '../_shared/pin.ts';

serve(async (req) => {
  const profile = await caller(req);
  const body = await readJson(req);
  const currentPin = stringField(body, 'currentPin');
  const newPin = stringField(body, 'newPin');
  await checkPin(profile, currentPin, clientIp(req));
  if (currentPin === newPin) throw new AppError('Choisissez un code différent de l’actuel.');
  assertPinFormat(newPin);
  check(await admin().rpc('svc_pin_save', { p_user: profile.id, p_pin_hash: await hashPin(profile.id, newPin) }));
  return { ok: true };
});
