import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import type { RedirectState } from './redirect';

export function FullPageLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-blue-50" role="status">
      <Loader2 className="h-8 w-8 animate-spin text-blue-700" aria-hidden="true" />
      <span className="sr-only">Chargement</span>
    </div>
  );
}

/**
 * Garde des pages connectées :
 * - personne n'est connecté → écran de connexion ;
 * - PIN jamais créé → création du PIN ;
 * - application verrouillée (ouverture, inactivité) → déverrouillage par PIN.
 * Dans les trois cas, la page demandée est rouverte ensuite.
 */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const { status, needsProfile, needsPin, locked } = useAuth();
  const location = useLocation();
  const state: RedirectState = { from: `${location.pathname}${location.search}` };

  if (status === 'loading') return <FullPageLoader />;
  if (status === 'anonymous') {
    return <Navigate to={needsProfile ? '/inscription' : '/connexion'} replace state={state} />;
  }
  if (needsPin) return <Navigate to="/connexion/pin/nouveau" replace state={state} />;
  if (locked) return <Navigate to="/connexion/pin" replace state={state} />;
  return <>{children ?? <Outlet />}</>;
}
