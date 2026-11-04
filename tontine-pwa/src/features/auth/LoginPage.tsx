import { lazy, Suspense, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, useAuthStore } from '@/hooks/useAuth';
import { isComputer } from '@/lib/device';
import { env } from '@/lib/env';
import { errorMessage } from '@/lib/errors';
import { isSenegalMobile } from '@/lib/validators';
import { authService } from '@/services';
import { AuthButton } from './components/AuthButton';
import { AuthScreen } from './components/AuthScreen';
import { PhoneField } from './components/PhoneField';
import { getRememberedAccount } from './rememberedAccount';
import { redirectTarget, type RedirectState } from './redirect';

// Comptes de démonstration : chargés seulement en mode simulé, absents de la version réelle.
const DemoAccountPicker = lazy(() =>
  import('./DemoAccountPicker').then((m) => ({ default: m.DemoAccountPicker })),
);

/**
 * Écran 1 — Numéro de téléphone.
 * - Téléphone : un code de vérification part par SMS. Si un compte est mémorisé sur
 *   l'appareil, on passe directement au PIN (sauf après « Changer de compte » ou
 *   « Modifier le numéro » : ?nouveau=1).
 * - Ordinateur (aucun compte mémorisé) : si le numéro a déjà un PIN, on le demande
 *   directement ; sinon (nouveau compte, PIN à recréer), le code SMS part.
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
  const computer = isComputer();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    setSending(true);
    setError(undefined);
    try {
      if (computer && (await authService.loginMethod(phone)) === 'pin') {
        useAuthStore.getState().setPendingPhone(phone);
        navigate('/connexion/pin', { state: location.state });
        return;
      }
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
          <Suspense fallback={null}>
            <DemoAccountPicker
              onDone={(signedIn) => navigate(redirectTarget(location, signedIn), { replace: true })}
            />
          </Suspense>
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
          hint={
            computer
              ? 'Si vous avez déjà un code PIN, il vous sera demandé. Sinon, vous recevrez un code par SMS.'
              : undefined
          }
        />
        <AuthButton type="submit" disabled={!valid} loading={sending}>
          {computer ? 'Continuer' : 'Recevoir le code'}
        </AuthButton>
      </form>
    </AuthScreen>
  );
}
