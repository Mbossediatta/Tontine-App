// Aller-retour vers la page de paiement (PayDunya / PayTech, ou la page simulée).
// Ce départ et ce retour rechargent toute l'application : sans cette marque, elle
// croirait être relancée et redemanderait le PIN (téléphone) ou fermerait la session
// (ordinateur) au milieu du paiement.
//
// La marque vit dans sessionStorage : propre à cet onglet, elle survit à l'aller-retour
// mais pas à la fermeture de l'onglet. Une vraie relance redemande donc toujours le PIN.

const KEY = 'calebasse.paymentRedirect.v1';
/** Au-delà, on considère que le paiement a été abandonné : verrouillage normal. */
const MAX_AGE_MS = 20 * 60 * 1000;

/** À appeler juste avant de partir vers la page de paiement. */
export function markPaymentRedirect(): void {
  try {
    window.sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // Stockage indisponible : le PIN sera simplement redemandé au retour.
  }
}

/** Vrai si l'application se recharge au milieu d'un paiement commencé il y a peu. */
export function isReturningFromPayment(now: number = Date.now()): boolean {
  try {
    const at = Number(window.sessionStorage.getItem(KEY));
    return at > 0 && now - at < MAX_AGE_MS;
  } catch {
    return false;
  }
}

/** Paiement terminé (page de succès ou d'échec affichée) : la marque n'a plus lieu d'être. */
export function clearPaymentRedirect(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Rien à effacer.
  }
}
