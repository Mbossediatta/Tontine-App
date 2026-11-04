/// <reference lib="webworker" />
// Service worker : précache de l'application, cache des données hors ligne, notifications push.
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { ExpirationPlugin } from 'workbox-expiration';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
  type PrecacheEntry,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<PrecacheEntry | string>;
};

// Fichiers de l'application en précache.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')));

// Réponses de données (API Supabase à venir) : réseau d'abord, cache pour le hors ligne.
registerRoute(
  ({ url }) => url.pathname.startsWith('/rest/v1/') || url.pathname.startsWith('/functions/v1/'),
  new NetworkFirst({
    cacheName: 'tontine-data',
    networkTimeoutSeconds: 5,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 }),
    ],
  }),
);

registerRoute(
  ({ url }) =>
    url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: 'google-fonts',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 }),
    ],
  }),
);

// Mise à jour à la demande (registerType: 'prompt') : le bandeau envoie SKIP_WAITING.
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

interface PushPayload {
  title?: string;
  body?: string;
  link?: string;
}

function readPayload(event: PushEvent): PushPayload {
  if (!event.data) return {};
  try {
    return event.data.json() as PushPayload;
  } catch {
    return { body: event.data.text() };
  }
}

// Affiche la notification reçue.
self.addEventListener('push', (event) => {
  const data = readPayload(event);
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Calebasse de l’Espoir', {
      body: data.body ?? '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      lang: 'fr',
      data: { link: data.link ?? '/' },
    }),
  );
});

// Au clic, ouvre le lien de la notification (dans un onglet existant si possible).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data as { link?: string } | null)?.link ?? '/';
  const target = new URL(link, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      const client = clients.find((c) => c.url.startsWith(self.location.origin));
      if (client) {
        await client.navigate(target);
        await client.focus();
        return;
      }
      await self.clients.openWindow(target);
    }),
  );
});
