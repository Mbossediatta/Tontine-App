import { useEffect } from 'react';
import { useAuthStore } from './useAuth';

/** Gestes qui comptent comme une activité. */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;
/** Fréquence de vérification pendant que l'application reste ouverte. */
const CHECK_EVERY_MS = 30_000;

/**
 * Verrouille l'application après `lockAfterMinutes` sans activité : la session reste
 * ouverte, mais le PIN est redemandé (écran de déverrouillage).
 * Vérifié régulièrement, et au retour sur l'application (téléphone sorti de veille,
 * onglet de nouveau visible), car les minuteurs sont suspendus en arrière-plan.
 */
export function useInactivityLock(): void {
  const minutes = useAuthStore((state) => state.lockAfterMinutes);

  useEffect(() => {
    let lastActivity = Date.now();
    const touch = () => {
      lastActivity = Date.now();
    };
    const check = () => {
      const { user, locked, setLocked } = useAuthStore.getState();
      if (user && !locked && Date.now() - lastActivity > minutes * 60_000) setLocked(true);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };

    ACTIVITY_EVENTS.forEach((name) => window.addEventListener(name, touch, { passive: true }));
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    return () => {
      ACTIVITY_EVENTS.forEach((name) => window.removeEventListener(name, touch));
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [minutes]);
}
