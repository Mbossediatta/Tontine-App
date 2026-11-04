// Compte mémorisé sur cet appareil, pour afficher directement « Bonjour Awa » et le
// pavé du PIN aux ouvertures suivantes et après une déconnexion. Seuls le numéro et
// le prénom sont gardés : jamais le PIN, ni en clair ni autrement.
// Téléphone uniquement : sur ordinateur (souvent partagé), rien n'est retenu.
import { isComputer } from '@/lib/device';

const KEY = 'calebasse.account.v1';

export interface RememberedAccount {
  phone: string;
  firstName: string;
}

/** Sur ordinateur, aucun compte n'est retenu : on redemande toujours le numéro. */
export function getRememberedAccount(): RememberedAccount | null {
  if (isComputer()) return null;
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
  if (isComputer()) return;
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
