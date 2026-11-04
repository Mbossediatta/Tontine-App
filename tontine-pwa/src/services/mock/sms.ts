// Envoi de SMS simulé : chaque message est inscrit au journal des SMS avec son coût
// (rubrique « Notifications et annonces » → suivi des SMS). Le backend appellera ici
// le fournisseur configuré dans les paramètres.
import type { SmsKind } from '@/types';
import { db, newId, nowIso } from './db';

export function sendSms(phone: string, kind: SmsKind): void {
  if (!phone) return;
  db.smsLog.push({ id: newId('sms'), phone, kind, at: nowIso(), cost: db.settings.sms.costPerSms });
}

/** SMS à un utilisateur connu (ignoré si le compte n'existe plus). */
export function sendSmsToUser(userId: string, kind: SmsKind): void {
  const user = db.users.find((u) => u.id === userId && !u.deletedAt);
  if (user) sendSms(user.phone, kind);
}
