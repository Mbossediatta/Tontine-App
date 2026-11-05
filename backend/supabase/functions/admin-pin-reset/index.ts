// Super admin : oblige une personne à recréer son PIN (après un code SMS) et ferme ses sessions.
import { admin, caller, check, recordAudit, recordSecurityEvent } from '../_shared/db.ts';
import { AppError, clientIp, readJson, serve, stringField } from '../_shared/http.ts';

serve(async (req) => {
  const actor = await caller(req);
  if (actor.global_role !== 'super_admin') {
    await recordSecurityEvent({
      kind: 'access_denied', severity: 'warning',
      detail: 'Réinitialisation de PIN refusée (pas super administrateur)', userId: actor.id, ip: clientIp(req),
    });
    throw new AppError('Action réservée au super administrateur.', 'forbidden');
  }
  const userId = stringField(await readJson(req), 'userId');
  const target = check(
    await admin().from('profiles').select('id, first_name, last_name, deleted_at').eq('id', userId).maybeSingle(),
  ) as { id: string; first_name: string; last_name: string; deleted_at: string | null } | null;
  if (!target || target.deleted_at) throw new AppError('Ce membre n’existe pas.', 'not_found');

  check(await admin().rpc('svc_pin_require_reset', { p_user: target.id }));
  check(await admin().rpc('svc_revoke_sessions', { p_user: target.id }));
  await recordAudit({
    actorId: actor.id,
    action: 'pin_reset',
    summary: `a réinitialisé le PIN de ${target.first_name} ${target.last_name}`,
  });
  return { ok: true };
});
