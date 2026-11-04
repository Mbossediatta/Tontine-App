import { useEffect, useState } from 'react';
import { RefreshCw, WifiOff } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useOnline } from '@/hooks/useOnline';

const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/** Bandeau affiché en haut de l'écran quand la connexion est perdue. */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div
      role="status"
      className="sticky top-0 z-40 flex items-center justify-center gap-2 bg-ink px-4 py-2 text-label text-white"
    >
      <WifiOff className="h-4 w-4" aria-hidden="true" />
      Hors ligne : vous consultez les dernières données enregistrées.
    </div>
  );
}

/** Bandeau « Nouvelle version disponible » (service worker en mode prompt). */
export function UpdateBanner() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW: (_serviceWorkerUrl, nextRegistration) => {
      setRegistration(nextRegistration);
    },
  });

  useEffect(() => {
    if (!registration) return;

    const checkForUpdate = () => {
      if (!navigator.onLine) return;
      void registration.update().catch((error: unknown) => {
        console.error('Impossible de vérifier la mise à jour de la PWA.', error);
      });
    };
    const checkWhenVisible = () => {
      if (document.visibilityState === 'visible') checkForUpdate();
    };

    const intervalId = window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', checkWhenVisible);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', checkWhenVisible);
    };
  }, [registration]);

  if (!needRefresh) return null;
  return (
    <div
      role="status"
      className="sticky top-0 z-40 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-blue-700 px-4 py-2 text-label text-white"
      style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
    >
      <span>Une nouvelle version est disponible.</span>
      <button
        type="button"
        onClick={() => void updateServiceWorker(true)}
        className="inline-flex min-h-touch items-center gap-1 rounded-control bg-white px-3 font-semibold text-blue-700"
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        Mettre à jour
      </button>
      <button
        type="button"
        onClick={() => setNeedRefresh(false)}
        className="min-h-touch px-2 underline"
      >
        Plus tard
      </button>
    </div>
  );
}
