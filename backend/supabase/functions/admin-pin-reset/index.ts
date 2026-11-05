// Super admin : oblige une personne à recréer son PIN (après un code SMS) et ferme ses sessions.
import { admin, check, recordAudit, superAdminCaller } from '../_shared/db.ts';
import { AppError, readJson, serve, stringField } from '../_shared/http.ts';

serve(async (req) => {
  const actor = await superAdminCaller(req, 'Réinitialisation de PIN refusée (pas super administrateur)');
  const userId = stringField(await readJson(req), 'userId');
  const target = check(
    await admin()
      .from('profiles')
      .select('id, first_name, last_name, global_role, deleted_at')
      .eq('id', userId)
      .maybeSingle(),
  ) as {
    id: string;
    first_name: string;
    last_name: string;
    global_role: string;
    deleted_at: string | null;
  } | null;
  if (!target || target.deleted_at) throw new AppError('Ce membre n’existe pas.', 'not_found');
  if (target.global_role === 'super_admin') {
    throw new AppError('Le compte du super administrateur ne se gère pas ici.', 'forbidden');
  }

  check(await admin().rpc('svc_pin_require_reset', { p_user: target.id }));
  check(await admin().rpc('svc_revoke_sessions', { p_user: target.id }));
  check(
    await admin().from('notifications').insert({
      user_id: target.id,
      type: 'security',
      title: 'PIN réinitialisé',
      body: 'À votre prochaine connexion, vous recevrez un code par SMS pour créer un nouveau PIN.',
    }),
  );
  await recordAudit({
    actorId: actor.id,
    action: 'pin_reset',
    summary: `a réinitialisé le PIN de ${target.first_name} ${target.last_name}`,
  });
  return { ok: true };
});
