// Compte mémorisé sur cet appareil, pour afficher directement « Bonjour Awa » et le
// pavé du PIN aux ouvertures suivantes. Seuls le numéro et le prénom sont gardés :
// jamais le PIN, ni en clair ni autrement.

const KEY = 'calebasse.account.v1';

export interface RememberedAccount {
  phone: string;
  firstName: string;
}

export function getRememberedAccount(): RememberedAccount | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<RememberedAccount>;
    return typeof value.phone === 'string' && typeof value.firstName === 'string'
      ? { phone: value.phone, firstName: value.firstName }
      : null;
  } catch {
    return null; // stockage indisponible ou donnée abîmée : comme s'il n'y avait rien
  }
}

export function rememberAccount(account: RememberedAccount): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(account));
  } catch {
    // Navigation privée : le numéro sera simplement redemandé à la prochaine ouverture.
  }
}

/** « Ce n'est pas vous ? Changer de compte » : l'appareil oublie le compte. */
export function forgetAccount(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Rien à faire si le stockage est indisponible.
  }
}
