/** Copie des données gardée sur le téléphone entre deux ouvertures (voir lib/persistCache). */
export const PERSISTED_CACHE_KEY = 'calebasse.cache.v1';

/** Durée de vie de cette copie (et des données en mémoire, qui doivent durer au moins autant). */
export const PERSIST_MAX_AGE = 24 * 60 * 60_000;

/**
 * Efface les données mises en cache : réponses de l'API gardées par le service worker
 * (voir src/sw/sw.ts) et copie des écrans gardée sur le téléphone. À appeler à chaque
 * déconnexion : sur un appareil partagé, le compte suivant ne doit retrouver aucune
 * donnée du précédent, même hors ligne.
 */
export async function clearDataCache(): Promise<void> {
  try {
    window.localStorage.removeItem(PERSISTED_CACHE_KEY);
  } catch {
    // Stockage indisponible : rien n'a été gardé.
  }
  try {
    if ('caches' in window) await caches.delete('tontine-data');
  } catch {
    // Cache indisponible (navigation privée) : rien à effacer.
  }
}
