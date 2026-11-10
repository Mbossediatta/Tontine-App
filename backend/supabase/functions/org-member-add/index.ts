// L'administration d'une organisation (admin général ou responsable de la structure) inscrit directement
// un militant, sans lien d'invitation. Numéro inconnu : le compte est créé (à sa première
// connexion, code SMS puis PIN). Numéro connu : la personne est simplement ajoutée.
import { admin, caller, checkBusiness, createAuthUser, profileByPhone } from '../_shared/db.ts';
import { AppError, phoneField, readJson, serve } from '../_shared/http.ts';

function text(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

serve(async (req) => {
  const actor = await caller(req);
  const body = await readJson(req);
  const phone = phoneField(body);
  const structureId = text(body, 'structureId');
  if (!structureId) throw new AppError('Choisissez la structure.');

  const existing = await profileByPhone(phone);
  if (!existing && (!text(body, 'firstName') || !text(body, 'lastName'))) {
    throw new AppError('Nouveau numéro : indiquez le prénom et le nom de la personne.');
  }
  const userId = existing?.id ?? (await createAuthUser());
  const result = await admin().rpc('svc_org_member_add', {
    p_actor: actor.id,
    p_structure: structureId,
    p_user: userId,
    p_is_new: !existing,
    p_phone: phone,
    p_first_name: text(body, 'firstName'),
    p_last_name: text(body, 'lastName'),
    p_region: text(body, 'region'),
    p_departement: text(body, 'departement'),
    p_commune: text(body, 'commune'),
    p_localite: text(body, 'localite'),
  });
  if (result.error && !existing) {
    // Inscription refusée : le compte Auth créé pour l'occasion est retiré.
    await admin().auth.admin.deleteUser(userId);
  }
  return checkBusiness(result);
});
