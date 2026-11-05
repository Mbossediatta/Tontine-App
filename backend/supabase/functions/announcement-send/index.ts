// Annonce du super admin : notification à chaque destinataire (svc_announcement), puis un
// SMS Orange (motif « announcement », coût suivi dans sms_log). Renvoie le nombre de
// destinataires. Un SMS en échec n'annule pas l'annonce : il est compté à part.
import { admin, checkBusiness, superAdminCaller } from '../_shared/db.ts';
import { AppError, readJson, serve, stringField } from '../_shared/http.ts';
import { sendSms } from '../_shared/orange-sms.ts';

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

  let smsFailed = 0;
  for (const recipient of recipients) {
    try {
      await sendSms(recipient.phone, `${title} : ${message}`, 'announcement', recipient.id);
    } catch (error) {
      smsFailed += 1;
      console.error('SMS d’annonce non envoyé', error instanceof Error ? error.message : '');
    }
  }
  return { count: recipients.length, smsFailed };
});
