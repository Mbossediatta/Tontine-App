// Numéro prouvé par SMS et sans compte : crée le compte (le PIN reste à créer).
import { readProof } from '../_shared/crypto.ts';
import {
  admin, createAuthUser, profileByPhone, recordAudit, recordSecurityEvent,
} from '../_shared/db.ts';
import { AppError, clientIp, readJson, serve, stringField } from '../_shared/http.ts';

const NAME = /^[\p{L}\p{M}' .-]{2,40}$/u;

serve(async (req) => {
  const body = await readJson(req);
  const phone = await readProof(body.proofToken);
  const fields = { 'Prénom': stringField(body, 'firstName'), 'Nom': stringField(body, 'lastName') };

  for (const [label, value] of Object.entries(fields)) {
    if (value.length < 2 || value.length > 40) {
      throw new AppError(`${label} : entre 2 et 40 caractères.`);
    }
    if (!NAME.test(value)) {
      await recordSecurityEvent({
        kind: 'suspicious_input', severity: 'warning',
        detail: `Saisie refusée (${label}) à la création d’un compte`, phone, ip: clientIp(req),
      });
      throw new AppError(`${label} : utilisez seulement des lettres, espaces, tirets et apostrophes.`);
    }
  }

  if (await profileByPhone(phone)) throw new AppError('Un compte existe déjà avec ce numéro.', 'conflict');

  const id = await createAuthUser();
  const { error } = await admin().from('profiles').insert({
    id, phone, first_name: fields['Prénom'], last_name: fields['Nom'],
  });
  if (error) {
    await admin().auth.admin.deleteUser(id);
    if (error.code === '23505') throw new AppError('Un compte existe déjà avec ce numéro.', 'conflict');
    throw new Error(error.message);
  }
  await recordAudit({ actorId: id, action: 'signed_up', summary: 'a créé son compte' });
  return { ok: true };
});
