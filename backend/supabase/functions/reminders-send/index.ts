// Relance manuelle (boutons « Relancer » de l'admin du groupe ou du super admin) :
// svc_reminder_prepare vérifie les droits, retient ceux qui n'ont pas payé et pas encore été
// relancés aujourd'hui, les prévient dans l'appli et trace l'action ; ici, le SMS « Retard »
// part dans la langue de chacun. Un SMS en échec n'annule pas la relance : compté à part.
import { admin, caller, checkBusiness } from '../_shared/db.ts';
import { AppError, readJson, serve, stringField } from '../_shared/http.ts';
import { sendSms } from '../_shared/orange-sms.ts';

interface Target {
  userId: string;
  phone: string;
  firstName: string;
  language: string;
  amount: number;
  sms: boolean;
}

/** « 45 000 FCFA » avec des espaces simples : un SMS sans caractère spécial reste moins cher. */
function amountText(value: number): string {
  return `${String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA`;
}

/** « 2026-11-05 » → « 05/11/2026 ». */
function dateText(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

function render(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

serve(async (req) => {
  const actor = await caller(req);
  const body = await readJson(req);
  const roundId = stringField(body, 'roundId');
  const userId = body.userId === undefined ? null : stringField(body, 'userId');
  if (userId !== null && !/^[0-9a-f-]{36}$/i.test(userId)) throw new AppError('Membre invalide.');

  const prepared = checkBusiness(
    await admin().rpc('svc_reminder_prepare', { p_actor: actor.id, p_round: roundId, p_user: userId }),
  ) as { targets: Target[]; groupName: string; dueDate: string };

  // Un modèle par langue, lu une seule fois.
  const templates = new Map<string, string>();
  let smsFailed = 0;
  for (const target of prepared.targets) {
    if (!target.sms) continue;
    if (!templates.has(target.language)) {
      const template = checkBusiness(
        await admin().rpc('svc_sms_template', { p_key: 'late', p_language: target.language }),
      ) as string;
      templates.set(target.language, template);
    }
    const text = render(templates.get(target.language) ?? '', {
      prenom: target.firstName,
      montant: amountText(target.amount),
      groupe: prepared.groupName,
      date: dateText(prepared.dueDate),
    });
    try {
      await sendSms(target.phone, text, 'reminder', target.userId);
    } catch (error) {
      smsFailed += 1;
      console.error('SMS de relance non envoyé', error instanceof Error ? error.message : '');
    }
  }
  return { count: prepared.targets.length, smsFailed };
});
