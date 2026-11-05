// Rafraîchissement de la page (F5) : ce n'est pas une nouvelle ouverture de l'application.
// Sans cette marque, l'ordinateur fermerait la session et le téléphone redemanderait le PIN
// à chaque rechargement.
//
// La marque vit dans sessionStorage : propre à cet onglet, elle survit au rechargement
// mais pas à la fermeture de l'onglet. Elle n'est posée que pendant que l'application est
// déverrouillée : une application verrouillée (inactivité) le reste après un rechargement.

const KEY = 'calebasse.tabSession.v1';

/** Session ouverte et déverrouillée dans cet onglet (ou non). */
export function setTabSessionActive(active: boolean): void {
  try {
    if (active) window.sessionStorage.setItem(KEY, '1');
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // Stockage indisponible : un rechargement se comportera comme une nouvelle ouverture.
  }
}

/** Vrai si la page est rechargée alors que la session était ouverte dans cet onglet. */
export function isTabSessionActive(): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
