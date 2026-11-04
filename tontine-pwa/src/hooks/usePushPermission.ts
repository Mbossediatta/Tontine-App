import { useCallback, useState } from 'react';
import { env } from '@/lib/env';
import { notificationService } from '@/services';

export type PushState = 'unsupported' | 'default' | 'granted' | 'denied';

function readState(): PushState {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return 'unsupported';
  return Notification.permission;
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = window.atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

/** Le service worker n'est pas actif en développement : on n'attend pas indéfiniment. */
function readyRegistration(timeoutMs = 4000): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

/**
 * Permission de notification et abonnement push.
 * La permission n'est demandée qu'au clic, jamais au chargement.
 */
export function usePushPermission() {
  const [state, setState] = useState<PushState>(readState);
  const [busy, setBusy] = useState(false);

  const subscribe = useCallback(async (): Promise<PushState> => {
    if (readState() === 'unsupported') return 'unsupported';
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      setState(permission);
      if (permission !== 'granted') return permission;
      const registration = await readyRegistration();
      if (registration && env.vapidPublicKey) {
        const existing = await registration.pushManager.getSubscription();
        const subscription =
          existing ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(env.vapidPublicKey),
          }));
        await notificationService.savePushSubscription(subscription.toJSON());
      }
      return permission;
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, busy, subscribe };
}
