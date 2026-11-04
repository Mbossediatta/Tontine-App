import { useSyncExternalStore } from 'react';

/**
 * Indique si une media query CSS est satisfaite, et se met à jour quand
 * l'écran change (rotation, redimensionnement).
 * Exemple : `useMediaQuery('(min-width: 640px)')` → vrai à partir de 640 px.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    // Hors navigateur (tests, rendu serveur) : on suppose un grand écran.
    () => true,
  );
}
