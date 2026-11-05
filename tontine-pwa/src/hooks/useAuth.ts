import { useEffect } from 'react';
import { create } from 'zustand';
import { clearDataCache } from '@/lib/dataCache';
import { isComputer } from '@/lib/device';
import { isReturningFromPayment } from '@/lib/paymentRedirect';
import { isTabSessionActive, setTabSessionActive } from '@/lib/tabSession';
import { authService } from '@/services';
import type { User } from '@/types';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

/** Délai d'inactivité par défaut avant verrouillage, en minutes (remplacé par celui du serveur). */
const DEFAULT_LOCK_MINUTES = 15;

interface AuthState {
  status: AuthStatus;
  user: User | null;
  /** Numéro en cours de connexion (code SMS envoyé, ou prouvé en attente du PIN). */
  pendingPhone: string | null;
  /** Numéro vérifié mais profil à compléter (première connexion). */
  needsProfile: boolean;
  /** Connecté, mais le PIN est à (re)créer avant d'utiliser l'application. */
  needsPin: boolean;
  /**
   * Application verrouillée : la session existe, mais le PIN est redemandé
   * (à chaque ouverture, et après une période d'inactivité).
   */
  locked: boolean;
  lockAfterMinutes: number;
  setUser: (user: User | null) => void;
  setPendingPhone: (phone: string | null) => void;
  setNeedsProfile: (needsProfile: boolean) => void;
  setNeedsPin: (needsPin: boolean) => void;
  setLocked: (locked: boolean) => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  status: 'loading',
  user: null,
  pendingPhone: null,
  needsProfile: false,
  needsPin: false,
  locked: false,
  lockAfterMinutes: DEFAULT_LOCK_MINUTES,
  // À la déconnexion (user null), PIN à créer et verrouillage n'ont plus d'objet.
  setUser: (user) =>
    set((state) => ({
      user,
      status: user ? 'authenticated' : 'anonymous',
      needsProfile: false,
      needsPin: user ? state.needsPin : false,
      locked: user ? state.locked : false,
    })),
  setPendingPhone: (pendingPhone) => set({ pendingPhone }),
  setNeedsProfile: (needsProfile) => set({ needsProfile }),
  setNeedsPin: (needsPin) => set({ needsPin }),
  setLocked: (locked) => set({ locked }),
}));

// Marque de l'onglet (lib/tabSession) : posée tant que l'application est ouverte et
// déverrouillée, retirée à la déconnexion et au verrouillage.
useAuthStore.subscribe((state) => {
  if (state.status === 'loading') return;
  setTabSessionActive(state.status === 'authenticated' && !state.locked && !state.needsPin);
});

/** Utilisateur connecté et état de la session. */
export function useAuth() {
  const status = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);
  const needsProfile = useAuthStore((state) => state.needsProfile);
  const needsPin = useAuthStore((state) => state.needsPin);
  const locked = useAuthStore((state) => state.locked);
  return {
    status,
    user,
    needsProfile,
    needsPin,
    locked,
    isAdmin: user?.globalRole === 'admin' || user?.globalRole === 'super_admin',
    isSuperAdmin: user?.globalRole === 'super_admin',
  };
}

/** Utilisateur connecté, garanti non nul (à utiliser sous RequireAuth). */
export function useCurrentUser(): User {
  const user = useAuthStore((state) => state.user);
  if (!user) throw new Error('useCurrentUser doit être utilisé sous RequireAuth');
  return user;
}

/**
 * Lit la session au démarrage de l'application.
 * - Téléphone : une session existante démarre verrouillée ; à chaque ouverture, le PIN
 *   est redemandé (écran « Bonjour Awa »).
 * - Ordinateur (souvent partagé) : rien n'est retenu d'une ouverture à l'autre ; une
 *   session restée ouverte est fermée et l'écran du numéro s'affiche.
 * - Exceptions : retour de la page de paiement (aller-retour qui recharge l'appli) et
 *   rechargement de la page (F5) ; ce n'est pas une relance, la session continue sans
 *   PIN (voir lib/paymentRedirect et lib/tabSession).
 */
export function useAuthBootstrap(): void {
  useEffect(() => {
    let cancelled = false;
    authService
      .getSession()
      .then(async (session) => {
        if (cancelled) return;
        useAuthStore.setState({ lockAfterMinutes: session.lockAfterMinutes });
        const resumed = session.user !== null && (isReturningFromPayment() || isTabSessionActive());
        if (session.user && isComputer() && !resumed) {
          await authService.logout();
          await clearDataCache();
          if (!cancelled) useAuthStore.getState().setUser(null);
          return;
        }
        const store = useAuthStore.getState();
        store.setUser(session.user);
        store.setNeedsProfile(session.needsProfile);
        store.setNeedsPin(session.needsPin);
        store.setLocked(session.user !== null && !session.needsPin && !resumed);
      })
      .catch(() => {
        if (!cancelled) useAuthStore.getState().setUser(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);
}
