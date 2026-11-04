import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/hooks/useAuth';
import { env } from '@/lib/env';
import { errorMessage } from '@/lib/errors';
import { formatPhone } from '@/lib/format';
import { authService } from '@/services';
import { AuthError, AuthLink } from './components/AuthButton';
import { AuthScreen } from './components/AuthScreen';
import { CodeBoxes } from './components/CodeBoxes';
import type { RedirectState } from './redirect';

const CODE_LENGTH = 6;
/** Secondes avant de pouvoir redemander un code. */
const RESEND_DELAY = 45;

/** « 0:45 » */
const formatCountdown = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * Écran 2 — Code de vérification reçu par SMS.
 * Validé automatiquement au 6e chiffre. Ensuite, selon le compte :
 * profil à remplir (numéro inconnu), PIN à créer (1re fois ou PIN oublié), ou PIN à saisir.
 */
export default function OtpPage() {
  const phone = useAuthStore((state) => state.pendingPhone);
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as RedirectState | null) ?? {};
  const resetting = state.purpose === 'reset';

  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [shakeKey, setShakeKey] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(RESEND_DELAY);
  const lastSubmitted = useRef('');

  // Compte à rebours avant « Renvoyer le code ».
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = window.setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [secondsLeft]);

  const verify = async (value: string) => {
    if (!phone) return;
    setVerifying(true);
    setError(undefined);
    try {
      const result = await authService.verifyOtp(phone, value);
      if (result.isNewAccount) {
        useAuthStore.getState().setNeedsProfile(true);
        navigate('/inscription', { replace: true, state });
      } else if (resetting || !result.hasPin) {
        navigate('/connexion/pin/nouveau', {
          replace: true,
          state: { ...state, firstName: result.firstName },
        });
      } else {
        // Compte connu avec son PIN (nouvel appareil) : il suffit de le saisir.
        navigate('/connexion/pin', {
          replace: true,
          state: { ...state, firstName: result.firstName },
        });
      }
    } catch (err) {
      setError(errorMessage(err));
      setShakeKey((k) => k + 1);
      setCode('');
    } finally {
      setVerifying(false);
    }
  };

  // Validation automatique dès que les 6 chiffres sont saisis.
  useEffect(() => {
    if (code.length === CODE_LENGTH && code !== lastSubmitted.current) {
      lastSubmitted.current = code;
      void verify(code);
    }
    if (code.length < CODE_LENGTH) lastSubmitted.current = '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  if (!phone) return <Navigate to="/connexion" replace />;

  const resend = async () => {
    setResending(true);
    setError(undefined);
    try {
      await authService.sendOtp(phone);
      setSecondsLeft(RESEND_DELAY);
      setCode('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setResending(false);
    }
  };

  /** Changer de numéro : retour à l'écran 1 (ou au PIN si on venait de « PIN oublié »). */
  const changeNumber = () =>
    navigate(resetting ? '/connexion/pin' : '/connexion?nouveau=1', { replace: true, state });

  return (
    <AuthScreen
      title="Code de vérification"
      subtitle={
        <>
          <p>
            Entrez le code envoyé au{' '}
            <strong className="whitespace-nowrap font-semibold text-auth-ink">
              {formatPhone(phone)}
            </strong>
          </p>
          <AuthLink onClick={changeNumber} className="mt-1">
            Modifier le numéro
          </AuthLink>
        </>
      }
      // La progression n'a de sens que pendant une connexion, pas pour « PIN oublié ».
      step={resetting ? undefined : { current: 2, total: 3 }}
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (code.length === CODE_LENGTH) void verify(code);
        }}
      >
        <CodeBoxes
          label="Code de vérification à 6 chiffres"
          value={code}
          onChange={(value) => {
            setCode(value);
            if (error) setError(undefined);
          }}
          invalid={Boolean(error)}
          shakeKey={shakeKey}
          disabled={verifying}
        />
        <AuthError>{error}</AuthError>
        {verifying ? (
          <p role="status" className="text-center text-[14px] text-auth-muted">
            Vérification…
          </p>
        ) : null}

        <div className="flex min-h-[44px] items-center justify-center">
          {secondsLeft > 0 ? (
            <p className="text-[14px] tabular-nums text-auth-muted">
              Renvoyer le code dans {formatCountdown(secondsLeft)}
            </p>
          ) : (
            <AuthLink onClick={() => void resend()} disabled={resending}>
              {resending ? 'Envoi…' : 'Renvoyer le code'}
            </AuthLink>
          )}
        </div>

        {env.useMocks ? (
          <p className="rounded-[12px] bg-auth-page px-4 py-3 text-center text-[13px] leading-5 text-auth-muted">
            Mode démonstration : aucun SMS n’est envoyé. Le code est affiché dans la console du
            navigateur (touche F12).
          </p>
        ) : null}
      </form>
    </AuthScreen>
  );
}
