// Écran de démarrage (défini dans index.html) : on le retire en fondu quand
// l'application est prête, après une durée minimale pour que l'animation se voie.

/**
 * Durée minimale d'affichage, comptée depuis l'ouverture de la page : le logo, le nom
 * et la phrase sont en place vers 1 s ; on les laisse ensuite se voir environ
 * 2,5 secondes avant le fondu (demande du 2026-11-04 : un peu plus long).
 */
const MIN_VISIBLE_MS = 3500;
/** Durée du fondu de sortie (voir #splash.splash-hide dans index.html). */
const FADE_MS = 450;

export function hideSplash(): void {
  const splash = document.getElementById('splash');
  if (!splash) return;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const wait = reduced ? 0 : Math.max(0, MIN_VISIBLE_MS - performance.now());
  window.setTimeout(() => {
    splash.classList.add('splash-hide');
    window.setTimeout(() => splash.remove(), FADE_MS);
  }, wait);
}
