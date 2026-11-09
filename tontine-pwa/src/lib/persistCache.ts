import { useEffect } from 'react';
import { useQueryClient, type Query } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { useAuthStore } from '@/hooks/useAuth';
import { PERSIST_MAX_AGE, PERSISTED_CACHE_KEY } from './dataCache';
import { isComputer } from './device';

/**
 * Données gardées sur le téléphone d'une ouverture à l'autre : à l'ouverture, les écrans
 * s'affichent tout de suite avec les dernières données connues, puis se mettent à jour
 * en arrière-plan (la copie gardée n'empêche jamais le rechargement depuis le serveur).
 *
 * - Téléphone seulement : un ordinateur est souvent partagé, rien n'y est retenu.
 * - Copie liée au compte : celle d'un autre compte est jetée sans être affichée.
 * - Effacée à chaque déconnexion (voir lib/dataCache).
 */

/** Données qui ne valent pas la peine d'être gardées (lues une fois, ou de passage). */
const NOT_PERSISTED = new Set(['legal-terms', 'simulation']);

function shouldPersist(query: Query): boolean {
  return query.state.status === 'success' && !NOT_PERSISTED.has(String(query.queryKey[0]));
}

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined; // stockage bloqué (navigation privée) : rien n'est gardé
  }
}

/** À monter une fois, sous le fournisseur de React Query. */
export function usePersistedCache(): void {
  const queryClient = useQueryClient();
  const userId = useAuthStore((state) =>
    state.status === 'authenticated' ? state.user?.id : null,
  );

  useEffect(() => {
    if (!userId || isComputer()) return;
    const [unsubscribe] = persistQueryClient({
      queryClient,
      persister: createSyncStoragePersister({
        storage: storage(),
        key: PERSISTED_CACHE_KEY,
        throttleTime: 1000,
      }),
      // Une copie faite pour un autre compte (ou une version plus ancienne) est jetée.
      buster: `1:${userId}`,
      maxAge: PERSIST_MAX_AGE,
      dehydrateOptions: { shouldDehydrateQuery: shouldPersist },
    });
    return unsubscribe;
  }, [queryClient, userId]);
}
