import type { Location } from 'react-router-dom';
import type { User } from '@/types';

export interface RedirectState {
  from?: string;
  /** Écran du code SMS : « reset » quand on vient de « Code PIN oublié ? ». */
  purpose?: 'login' | 'reset';
  /** Prénom du compte, pour « Bonjour Awa » sur l'écran du PIN. */
  firstName?: string;
}

/**
 * Code d'invitation du parcours en cours : la personne a ouvert un lien /rejoindre/CODE
 * (ou saisi son code) avant de se connecter. Il ouvre l'inscription d'un nouveau numéro.
 */
export function inviteCodeOf(state: RedirectState | null | undefined): string | undefined {
  return state?.from?.match(/^\/rejoindre\/([A-Za-z0-9]{4,12})$/)?.[1]?.toUpperCase();
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
