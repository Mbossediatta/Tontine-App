import { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { useAuthStore } from '@/hooks/useAuth';
import { errorMessage } from '@/lib/errors';
import { DEMO_ACCOUNTS } from '@/mocks';
import { DEMO_PIN } from '@/lib/demo';
import { authService } from '@/services';
import { demoLogin } from '@/services/mock/auth.mock';
import type { User } from '@/types';
import { rememberAccount } from './rememberedAccount';

/**
 * Comptes de démonstration (affichés seulement si VITE_USE_MOCKS=true) : connexion
 * directe, sans SMS. Le compte est mémorisé : à la prochaine ouverture, l'écran de
 * déverrouillage demande son PIN (le même pour tous : affiché ci-dessous).
 */
export function DemoAccountPicker({ onDone }: { onDone: (user: User | null) => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  const login = async (userId: string) => {
    setBusyId(userId);
    setError(undefined);
    try {
      await demoLogin(userId);
      const session = await authService.getSession();
      const store = useAuthStore.getState();
      store.setUser(session.user);
      store.setNeedsPin(session.needsPin);
      store.setLocked(false);
      if (session.user) {
        rememberAccount({ phone: session.user.phone, firstName: session.user.firstName });
      }
      onDone(session.user);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="rounded-[16px] border border-dashed border-auth-line px-4 py-4 font-jakarta">
      <p className="flex items-center gap-2 text-[13px] font-semibold text-auth-muted">
        <FlaskConical className="h-4 w-4" aria-hidden="true" />
        Mode démonstration · PIN des comptes : {DEMO_PIN}
      </p>
      <ul className="mt-3 grid grid-cols-2 gap-2">
        {DEMO_ACCOUNTS.map((account) => (
          <li key={account.userId}>
            <button
              type="button"
              disabled={busyId !== null}
              onClick={() => void login(account.userId)}
              className="flex min-h-[56px] w-full flex-col items-start justify-center rounded-[12px] bg-white px-3 py-2 text-left transition-colors hover:bg-[#E8EEF5] focus-visible:outline focus-visible:outline-2 focus-visible:outline-auth-primary disabled:opacity-60"
            >
              <span className="text-[14px] font-semibold text-auth-ink">
                {busyId === account.userId ? 'Connexion…' : account.label}
              </span>
              <span className="text-[12px] leading-4 text-auth-muted">{account.detail}</span>
            </button>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-auth-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
