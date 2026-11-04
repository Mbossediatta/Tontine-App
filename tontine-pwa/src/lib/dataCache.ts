/**
 * Efface les données mises en cache par le service worker (réponses de l'API, voir
 * src/sw/sw.ts). À appeler à chaque déconnexion : sur un appareil partagé, le compte
 * suivant ne doit retrouver aucune donnée du précédent, même hors ligne.
 */
export async function clearDataCache(): Promise<void> {
  try {
    if ('caches' in window) await caches.delete('tontine-data');
  } catch {
    // Cache indisponible (navigation privée) : rien à effacer.
  }
}
