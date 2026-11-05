// Le super admin crée le compte d'un participant : à sa 1re connexion, code SMS puis PIN.
import { admin, checkBusiness, createAuthUser, superAdminCaller } from '../_shared/db.ts';
import { phoneField, readJson, serve, stringField } from '../_shared/http.ts';

serve(async (req) => {
  const actor = await superAdminCaller(req, 'Création de compte refusée (pas super administrateur)');
  const body = await readJson(req);
  const phone = phoneField(body);
  const firstName = stringField(body, 'firstName');
  const lastName = stringField(body, 'lastName');

  const userId = await createAuthUser();
  const result = await admin().rpc('svc_member_create', {
    p_actor: actor.id,
    p_user: userId,
    p_phone: phone,
    p_first_name: firstName,
    p_last_name: lastName,
  });
  if (result.error) {
    // Profil refusé (numéro déjà pris, nom invalide…) : le compte Auth créé est retiré.
    await admin().auth.admin.deleteUser(userId);
  }
  return { id: checkBusiness(result) as string };
});
