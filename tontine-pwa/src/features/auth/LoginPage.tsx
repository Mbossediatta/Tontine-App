import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, useAuthStore } from '@/hooks/useAuth';
import { env } from '@/lib/env';
import { errorMessage } from '@/lib/errors';
import { isSenegalMobile } from '@/lib/validators';
import { authService } from '@/services';
import { AuthButton } from './components/AuthButton';
import { AuthScreen } from './components/AuthScreen';
import { PhoneField } from './components/PhoneField';
import { DemoAccountPicker } from './DemoAccountPicker';
import { getRememberedAccount } from './rememberedAccount';
import { redirectTarget, type RedirectState } from './redirect';

/**
 * Écran 1 — Numéro de téléphone. Un code de vérification part par SMS.
 * Si un compte est mémorisé sur cet appareil, on passe directement au PIN
 * (sauf après « Changer de compte » ou « Modifier le numéro » : ?nouveau=1).
 */
export default function LoginPage() {
  const { status, user, locked } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [phone, setPhone] = useState(useAuthStore.getState().pendingPhone ?? '');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();

  if (status === 'authenticated' && !locked) {
    return <Navigate to={redirectTarget(location, user)} replace />;
  }
  const remembered = getRememberedAccount();
  if ((remembered || locked) && !params.has('nouveau')) {
    return <Navigate to="/connexion/pin" replace state={location.state} />;
  }

  const valid = isSenegalMobile(phone);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    setSending(true);
    setError(undefined);
    try {
      await authService.sendOtp(phone);
      useAuthStore.getState().setPendingPhone(phone);
      const state: RedirectState = {
        ...(location.state as RedirectState | null),
        purpose: 'login',
      };
      navigate('/connexion/code', { state });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <AuthScreen
      title="Connexion"
      subtitle="Accédez à vos groupes et suivez vos cotisations."
      below={
        env.useMocks ? (
          <DemoAccountPicker
            onDone={(signedIn) => navigate(redirectTarget(location, signedIn), { replace: true })}
          />
        ) : null
      }
    >
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-6" noValidate>
        <PhoneField
          value={phone}
          onChange={(digits) => {
            setPhone(digits);
            setError(undefined);
          }}
          error={error}
        />
        <AuthButton type="submit" disabled={!valid} loading={sending}>
          Recevoir le code
        </AuthButton>
      </form>
    </AuthScreen>
  );
}
