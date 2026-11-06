// Annonce du super admin : une notification à chaque destinataire (svc_announcement), qui
// part aussi en notification push sur son téléphone (push-send). Pas de SMS. Renvoie le
// nombre de destinataires.
import { admin, checkBusiness, superAdminCaller } from '../_shared/db.ts';
import { AppError, readJson, serve, stringField } from '../_shared/http.ts';

serve(async (req) => {
  const actor = await superAdminCaller(req, 'Annonce refusée (pas super administrateur)');
  const body = await readJson(req);
  const target = body.target as { kind?: string; groupId?: string } | undefined;
  if (!target || typeof target.kind !== 'string') throw new AppError('Destinataires invalides.');
  const title = stringField(body, 'title');
  const message = stringField(body, 'message');

  const recipients = checkBusiness(
    await admin().rpc('svc_announcement', {
      p_actor: actor.id,
      p_kind: target.kind,
      p_group: target.kind === 'group' ? (target.groupId ?? null) : null,
      p_title: title,
      p_message: message,
    }),
  ) as Array<{ id: string; phone: string }>;
  return { count: recipients.length };
});
