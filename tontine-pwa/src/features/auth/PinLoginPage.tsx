import { useEffect, useRef, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/hooks/useAuth';
import { env } from '@/lib/env';
import { errorMessage, ServiceError } from '@/lib/errors';
import { DEMO_PIN } from '@/mocks/pins';
import { authService } from '@/services';
import { AuthButton, AuthError, AuthLink } from './components/AuthButton';
import { AuthScreen } from './components/AuthScreen';
import { PIN_LENGTH, PinPad } from './components/PinPad';
import { forgetAccount, getRememberedAccount, rememberAccount } from './rememberedAccount';
import { redirectTarget, type RedirectState } from './redirect';

/**
 * Écran 4 — Déverrouillage par code PIN (ouvertures suivantes, après inactivité, ou
 * compte connu sur un nouvel appareil après le code SMS).
 * Après trop d'erreurs, le PIN est bloqué : seule la vérification par SMS permet
 * d'en créer un nouveau.
 */
/** Message affiché quand le PIN ne peut plus être utilisé : une seule issue, le SMS. */
const BLOCK_MESSAGES = {
  blocked:
    'Trop d’essais : votre code PIN est bloqué. Pour votre sécurité, confirmez votre identité par SMS, puis créez un nouveau code PIN.',
  reset:
    'Votre code PIN a été réinitialisé. Confirmez votre identité par SMS, puis créez un nouveau code PIN.',
} as const;

export default function PinLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const state = (location.state as RedirectState | null) ?? {};
  const sessionUser = useAuthStore((s) => s.user);
  const pendingPhone = useAuthStore((s) => s.pendingPhone);

  // Le compte à déverrouiller : session verrouillée, numéro tout juste prouvé, ou
  // compte mémorisé sur cet appareil.
  const remembered = getRememberedAccount();
  const account = sessionUser
    ? { phone: sessionUser.phone, firstName: sessionUser.firstName }
    : pendingPhone
      ? { phone: pendingPhone, firstName: state.firstName ?? remembered?.firstName ?? '' }
      : remembered;

  const [pin, setPin] = useState('');
  const [error, setError] = useState<string>();
  const [shakeKey, setShakeKey] = useState(0);
  const [checking, setChecking] = useState(false);
  // PIN bloqué (trop d'erreurs) ou réinitialisé par l'administration : SMS obligatoire.
  const [blockReason, setBlockReason] = useState<'blocked' | 'reset' | null>(null);
  const blocked = blockReason !== null;
  const [sendingSms, setSendingSms] = useState(false);
  const lastSubmitted = useRef('');

  const unlock = async (value: string) => {
    if (!account) return;
    setChecking(true);
    setError(undefined);
    try {
      const user = await authService.loginWithPin(account.phone, value);
      const store = useAuthStore.getState();
      store.setPendingPhone(null);
      store.setUser(user);
      store.setNeedsPin(false);
      store.setLocked(false);
      rememberAccount({ phone: user.phone, firstName: user.firstName });
      navigate(redirectTarget(location, user), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setShakeKey((k) => k + 1);
      setPin('');
      // « forbidden » : bloqué après trop d'essais ; « conflict » : PIN à recréer.
      if (err instanceof ServiceError && err.code === 'forbidden') setBlockReason('blocked');
      if (err instanceof ServiceError && err.code === 'conflict') setBlockReason('reset');
    } finally {
      setChecking(false);
    }
  };

  // Vérification automatique au 4e chiffre.
  useEffect(() => {
    if (pin.length === PIN_LENGTH && pin !== lastSubmitted.current) {
      lastSubmitted.current = pin;
      void unlock(pin);
    }
    if (pin.length < PIN_LENGTH) lastSubmitted.current = '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  if (!account) return <Navigate to="/connexion?nouveau=1" replace />;

  /** « Code PIN oublié ? » ou PIN bloqué : code SMS, puis création d'un nouveau PIN. */
  const verifyBySms = async () => {
    setSendingSms(true);
    try {
      await authService.sendOtp(account.phone);
      useAuthStore.getState().setPendingPhone(account.phone);
      navigate('/connexion/code', {
        state: { ...state, purpose: 'reset', firstName: account.firstName },
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSendingSms(false);
    }
  };

  /** « Ce n'est pas vous ? » : on ferme la session, l'appareil oublie le compte. */
  const switchAccount = async () => {
    await authService.logout();
    queryClient.clear();
    forgetAccount();
    const store = useAuthStore.getState();
    store.setPendingPhone(null);
    store.setUser(null);
    navigate('/connexion?nouveau=1', { replace: true });
  };

  return (
    <AuthScreen
      title={account.firstName ? `Bonjour ${account.firstName}` : 'Bonjour'}
      subtitle={blocked ? undefined : 'Saisissez votre code PIN pour continuer.'}
    >
      <div className="flex flex-col items-center gap-5">
        {blocked ? (
          // PIN bloqué : explication claire, et une seule issue, la vérification par SMS.
          <div className="flex w-full flex-col gap-5">
            <div
              role="alert"
              className="flex gap-3 rounded-[12px] border border-auth-error/30 bg-[#FBF0EF] p-4 text-[15px] leading-6 text-auth-error"
            >
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <p>{BLOCK_MESSAGES[blockReason]}</p>
            </div>
            <AuthButton loading={sendingSms} onClick={() => void verifyBySms()}>
              Recevoir un code par SMS
            </AuthButton>
          </div>
        ) : (
          <>
            <PinPad
              value={pin}
              onChange={(value) => {
                setPin(value);
                if (error && value.length > 0) setError(undefined);
              }}
              disabled={checking}
              shakeKey={shakeKey}
              invalid={Boolean(error) && pin.length === 0}
            />
            <AuthError>{error}</AuthError>
            {env.useMocks ? (
              <p className="text-[13px] text-auth-muted">
                Démonstration : PIN des comptes de démonstration {DEMO_PIN}.
              </p>
            ) : null}
            <AuthLink onClick={() => void verifyBySms()} disabled={sendingSms}>
              {sendingSms ? 'Envoi du code…' : 'Code PIN oublié ?'}
            </AuthLink>
          </>
        )}

        <AuthLink tone="muted" onClick={() => void switchAccount()}>
          Ce n’est pas vous ? Changer de compte
        </AuthLink>
      </div>
    </AuthScreen>
  );
}
