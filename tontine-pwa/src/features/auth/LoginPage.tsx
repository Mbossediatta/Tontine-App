import { lazy, Suspense, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, useAuthStore } from '@/hooks/useAuth';
import { isComputer } from '@/lib/device';
import { errorMessage, ServiceError } from '@/lib/errors';
import { isSenegalMobile } from '@/lib/checks';
import { authService } from '@/services';
import { AuthButton } from './components/AuthButton';
import { AuthScreen } from './components/AuthScreen';
import { PhoneField } from './components/PhoneField';
import { TextField } from './components/TextField';
import { getRememberedAccount } from './rememberedAccount';
import { inviteCodeOf, redirectTarget, type RedirectState } from './redirect';

// Comptes de démonstration : seulement en mode simulé. La condition porte directement sur
// import.meta.env pour être résolue à la construction : en production, ce code n'est
// même pas inclus dans l'application.
const DemoAccountPicker =
  import.meta.env.VITE_USE_MOCKS === 'true' && import.meta.env.VITE_AUTH_MODE !== 'supabase'
    ? lazy(() => import('./DemoAccountPicker').then((m) => ({ default: m.DemoAccountPicker })))
    : null;

/**
 * Écran 1 — Numéro de téléphone.
 * - Téléphone : un code de vérification part par SMS. Si un compte est mémorisé sur
 *   l'appareil, on passe directement au PIN (sauf après « Changer de compte » ou
 *   « Modifier le numéro » : ?nouveau=1).
 * - Ordinateur (aucun compte mémorisé) : si le numéro a déjà un PIN, on le demande
 *   directement ; sinon (nouveau compte, PIN à recréer), le code SMS part.
 * - Numéro inconnu : inscription sur invitation seulement. Venu d'un lien /rejoindre/CODE,
 *   le code est repris ; sinon le serveur refuse et l'on propose de saisir le code reçu.
 */
export default function LoginPage() {
  const { status, user, locked } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [phone, setPhone] = useState(useAuthStore.getState().pendingPhone ?? '');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  /** Numéro inconnu sans invitation : champ du code d'invitation affiché. */
  const [askInvite, setAskInvite] = useState(false);
  const [typedInvite, setTypedInvite] = useState('');

  if (status === 'authenticated' && !locked) {
    return <Navigate to={redirectTarget(location, user)} replace />;
  }
  const remembered = getRememberedAccount();
  if ((remembered || locked) && !params.has('nouveau')) {
    return <Navigate to="/connexion/pin" replace state={location.state} />;
  }

  const linkInvite = inviteCodeOf(location.state as RedirectState | null);
  const typed = typedInvite.trim().toUpperCase();
  const inviteCode = linkInvite ?? (askInvite && typed ? typed : undefined);
  const valid = isSenegalMobile(phone) && (!askInvite || /^[A-Z0-9]{4,12}$/.test(typed));
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
      await authService.sendOtp(phone, inviteCode);
      useAuthStore.getState().setPendingPhone(phone);
      const state: RedirectState = {
        ...(location.state as RedirectState | null),
        // Code saisi : après l'inscription, la demande d'adhésion s'ouvre directement.
        ...(inviteCode && !linkInvite ? { from: `/rejoindre/${inviteCode}` } : {}),
        purpose: 'login',
      };
      navigate('/connexion/code', { state });
    } catch (err) {
      if (err instanceof ServiceError && err.code === 'not_found' && !linkInvite) {
        setAskInvite(true);
      }
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
        DemoAccountPicker ? (
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
        {askInvite ? (
          <TextField
            label="Code d’invitation de votre groupe"
            placeholder="Ex. BUR92X"
            value={typedInvite}
            onChange={(event) => {
              setTypedInvite(event.target.value);
              setError(undefined);
            }}
            autoCapitalize="characters"
            autoComplete="off"
            maxLength={12}
          />
        ) : null}
        <AuthButton type="submit" disabled={!valid} loading={sending}>
          {computer ? 'Continuer' : 'Recevoir le code'}
        </AuthButton>
      </form>
    </AuthScreen>
  );
}
