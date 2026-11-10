// Notification push (Web Push) : appelée par la base à chaque notification créée (déclencheur
// notifications_push, …_notifications_push.sql), avec le secret partagé PUSH_SECRET. Envoie
// la notification à tous les téléphones abonnés du membre, selon ses préférences ; un
// abonnement expiré (téléphone désinstallé, permission retirée) est supprimé.
import webpush from 'npm:web-push@3.6.7';
import { admin, check } from '../_shared/db.ts';
import { requireEnv, safeEqual } from '../_shared/crypto.ts';
import { AppError, readJson, serve, stringField } from '../_shared/http.ts';

/** Type de notification → préférence du membre (Profil → Notifications). */
const PREFERENCE: Record<string, 'reminders' | 'beneficiary' | 'payments'> = {
  reminder: 'reminders',
  beneficiary: 'beneficiary',
  payment: 'payments',
  payout: 'payments',
};

interface Subscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

webpush.setVapidDetails(
  requireEnv('VAPID_SUBJECT'),
  requireEnv('VAPID_PUBLIC_KEY'),
  requireEnv('VAPID_PRIVATE_KEY'),
);

serve(async (req) => {
  if (!safeEqual(req.headers.get('x-push-secret') ?? '', requireEnv('PUSH_SECRET'))) {
    throw new AppError('Appel refusé.', 'forbidden');
  }
  const notificationId = stringField(await readJson(req), 'notificationId');

  const notification = check(
    await admin()
      .from('notifications')
      .select('user_id, type, title, body, link, app, profiles (notification_prefs, deleted_at)')
      .eq('id', notificationId)
      .maybeSingle(),
  ) as {
    user_id: string;
    type: string;
    title: string;
    body: string;
    link: string | null;
    app: string;
    profiles: { notification_prefs: Record<string, boolean> | null; deleted_at: string | null };
  } | null;
  if (!notification || notification.profiles.deleted_at) return { sent: 0 };
  const preference = PREFERENCE[notification.type];
  if (preference && notification.profiles.notification_prefs?.[preference] === false) {
    return { sent: 0 };
  }

  const subscriptions = check(
    await admin()
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', notification.user_id)
      // Calebasse ou appli d'une organisation : seulement les téléphones où elle est installée.
      .eq('app', notification.app),
  ) as Subscription[];
  const payload = JSON.stringify({
    title: notification.title,
    body: notification.body,
    link: notification.link ?? '/',
  });

  let sent = 0;
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        payload,
        { TTL: 24 * 3600, urgency: 'high' },
      );
      sent += 1;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await admin().from('push_subscriptions').delete().eq('id', subscription.id);
      } else {
        console.error('Notification push non envoyée', status ?? '');
      }
    }
  }
  return { sent };
});
