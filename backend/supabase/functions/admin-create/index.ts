// Le super admin promeut un compte existant ou prépare le compte d'un nouvel admin.
import { admin, caller, createAuthUser, recordSecurityEvent } from '../_shared/db.ts';
import { AppError, clientIp, phoneField, readJson, serve, stringField } from '../_shared/http.ts';

const NAME = /^[\p{L}\p{M}' .-]{2,40}$/u;

serve(async (req) => {
  const actor = await caller(req);
  if (actor.global_role !== 'super_admin') {
    await recordSecurityEvent({
      kind: 'access_denied',
      severity: 'warning',
      detail: 'Création d’administrateur refusée (pas super administrateur)',
      userId: actor.id,
      ip: clientIp(req),
    });
    throw new AppError('Action réservée au super administrateur.', 'forbidden');
  }

  const body = await readJson(req);
  const phone = phoneField(body);
  const firstName = stringField(body, 'firstName');
  const lastName = stringField(body, 'lastName');
  for (const [label, value] of [
    ['Prénom', firstName],
    ['Nom', lastName],
  ]) {
    if (!NAME.test(value)) {
      await recordSecurityEvent({
        kind: 'suspicious_input',
        severity: 'warning',
        detail: `Saisie refusée (${label}) lors de la création d’un administrateur`,
        userId: actor.id,
        phone,
        ip: clientIp(req),
      });
      throw new AppError(`${label} : utilisez seulement des lettres, espaces, tirets et apostrophes.`);
    }
  }

  const { data: existing, error: lookupError } = await admin()
    .from('profiles')
    .select('id, global_role, is_suspended, deleted_at')
    .eq('phone', phone)
    .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  if (existing?.deleted_at) throw new AppError('Ce numéro appartient à un compte supprimé.', 'conflict');
  if (existing?.is_suspended) throw new AppError('Ce compte est bloqué. Contactez un administrateur.', 'forbidden');
  if (existing && existing.global_role !== 'user') {
    throw new AppError('Cette personne est déjà administrateur.', 'conflict');
  }

  const newAuthUserId = existing ? null : await createAuthUser();
  const targetId = existing?.id ?? newAuthUserId;
  if (!targetId) throw new Error('Identifiant de compte manquant.');

  const { error } = await admin().rpc('svc_admin_create', {
    p_actor: actor.id,
    p_user: targetId,
    p_phone: phone,
    p_first_name: firstName,
    p_last_name: lastName,
  });
  if (error) {
    if (newAuthUserId) {
      const { error: cleanupError } = await admin().auth.admin.deleteUser(newAuthUserId);
      if (cleanupError) throw new Error(`Création annulée, nettoyage du compte impossible : ${cleanupError.message}`);
    }
    if (error.code === '23505') {
      throw new AppError('Cette personne est déjà administrateur.', 'conflict');
    }
    throw new Error(error.message);
  }

  return { ok: true };
});
