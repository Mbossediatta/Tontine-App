// Crée ou remplace le PIN, puis ouvre la session.
// Remplacer un PIN exige un numéro prouvé par SMS (jeton de preuve) ; seul un compte
// connecté qui n'a pas encore de PIN utilisable peut en créer un sans jeton.
import { assertPinFormat, hashPin, readProof } from '../_shared/crypto.ts';
import { admin, caller, check, openSession, profileByPhone, type Profile } from '../_shared/db.ts';
import { AppError, clientIp, readJson, serve, stringField } from '../_shared/http.ts';

serve(async (req) => {
  const body = await readJson(req);
  const pin = stringField(body, 'pin');
  assertPinFormat(pin);

  let profile: Profile | null;
  if (body.proofToken !== undefined) {
    profile = await profileByPhone(await readProof(body.proofToken));
    if (!profile) throw new AppError('Complétez d’abord votre profil.', 'conflict');
  } else {
    profile = await caller(req);
    const usable = check(await admin().rpc('svc_pin_usable', { p_user: profile.id })) as boolean;
    if (usable) throw new AppError('Session expirée, recommencez la connexion.', 'unauthenticated');
  }

  check(await admin().rpc('svc_pin_save', { p_user: profile.id, p_pin_hash: await hashPin(profile.id, pin) }));
  return openSession(profile, clientIp(req));
});
