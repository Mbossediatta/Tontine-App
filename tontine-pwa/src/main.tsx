import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import { hideSplash } from '@/app/splash';
import '@/styles/index.css';

/**
 * Après une mise à jour, un écran encore ouvert peut demander un morceau de l'ancienne
 * version, qui n'existe plus sur le serveur : on recharge une fois pour prendre la nouvelle
 * (au plus une fois toutes les 30 secondes, pour ne jamais boucler).
 */
window.addEventListener('vite:preloadError', (event) => {
  const key = 'calebasse.reloadAfterUpdate';
  try {
    const last = Number(sessionStorage.getItem(key) ?? 0);
    if (Date.now() - last < 30_000) return;
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    // Stockage indisponible : on recharge quand même une fois.
  }
  event.preventDefault();
  window.location.reload();
});

async function removeStaleDevelopmentWorker(): Promise<void> {
  if (!import.meta.env.DEV || !('serviceWorker' in navigator)) return;

  const reloadKey = `pwa-dev-cleanup:${window.location.origin}`;
  if (sessionStorage.getItem(reloadKey)) {
    sessionStorage.removeItem(reloadKey);
    return;
  }

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    const appRegistrations = registrations.filter((registration) =>
      [registration.active, registration.waiting, registration.installing].some((worker) => {
        if (!worker) return false;
        const url = new URL(worker.scriptURL);
        return url.origin === window.location.origin && url.pathname === '/sw.js';
      }),
    );
    if (appRegistrations.length === 0) return;

    await Promise.all(appRegistrations.map((registration) => registration.unregister()));
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter(
          (name) =>
            name.startsWith('workbox-precache-') ||
            name === 'tontine-data' ||
            name === 'google-fonts',
        )
        .map((name) => caches.delete(name)),
    );

    sessionStorage.setItem(reloadKey, 'true');
    window.location.reload();
  } catch (error) {
    console.error('Impossible de retirer l’ancienne version PWA du mode développement.', error);
  }
}

void removeStaleDevelopmentWorker();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Élément #root introuvable');
}

// Filet de sécurité : l'écran de démarrage ne reste jamais plus de 8 secondes,
// même si le chargement de la session n'aboutit pas.
window.setTimeout(hideSplash, 8000);

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
