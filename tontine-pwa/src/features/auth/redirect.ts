import type { Location } from 'react-router-dom';
import type { User } from '@/types';

export interface RedirectState {
  from?: string;
  /** Écran du code SMS : « reset » quand on vient de « Code PIN oublié ? ». */
  purpose?: 'login' | 'reset';
  /** Prénom du compte, pour « Bonjour Awa » sur l'écran du PIN. */
  firstName?: string;
}

/** Page d'accueil de chaque rôle : tableaux de bord admin, sinon accueil participant. */
export function roleHome(user: User | null): string {
  return user && user.globalRole !== 'user' ? '/admin' : '/';
}

/**
 * Page à ouvrir après la connexion : celle que la personne voulait voir (chemin
 * interne uniquement), sinon le tableau de bord de son rôle.
 */
export function redirectTarget(location: Location, user: User | null = null): string {
  const from = (location.state as RedirectState | null)?.from;
  return from && from.startsWith('/') && !from.startsWith('//') ? from : roleHome(user);
}
