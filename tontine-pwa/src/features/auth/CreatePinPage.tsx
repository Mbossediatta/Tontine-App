import { useEffect, useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, useAuthStore } from '@/hooks/useAuth';
import { errorMessage } from '@/lib/errors';
import { isWeakPin } from '@/lib/validators';
import { authService } from '@/services';
import type { User } from '@/types';
import { AuthError } from './components/AuthButton';
import { AuthScreen } from './components/AuthScreen';
import { PIN_LENGTH, PinPad } from './components/PinPad';
import { rememberAccount } from './rememberedAccount';
import { redirectTarget, type RedirectState } from './redirect';

/** Temps d'affichage de la confirmation verte avant d'entrer dans l'application. */
const SUCCESS_DELAY = 900;

/**
 * Écran 3 — Création du code PIN (1re connexion, ou après « Code PIN oublié ? »).
 * Deux étapes : le choisir, puis le confirmer. Les PIN trop simples sont refusés,
 * et si les deux saisies diffèrent, on recommence.
 */
export default function CreatePinPage() {
  const { status, needsPin, user } = useAuth();
  const pendingPhone = useAuthStore((state) => state.pendingPhone);
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as RedirectState | null) ?? {};
  const resetting = state.purpose === 'reset';

  // 1re saisie, gardée pendant la confirmation (null : on en est au choix).
  const [first, setFirst] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string>();
  const [shakeKey, setShakeKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<User | null>(null);
  const saved = useRef<User | null>(null);
  const confirming = first !== null;

  /** Erreur : message, tremblement des points, et la saisie repart de zéro. */
  const fail = (message: string) => {
    setError(message);
    setShakeKey((k) => k + 1);
    setPin('');
  };

  // Le PIN est vérifié dès le 4e chiffre.
  useEffect(() => {
    if (pin.length !== PIN_LENGTH || saving) return;
    if (!confirming) {
      if (isWeakPin(pin)) {
        fail('Ce code est trop simple (1234, 0000…). Choisissez-en un autre.');
        return;
      }
      setError(undefined);
      setFirst(pin);
      setPin('');
      return;
    }
    if (pin !== first) {
      setFirst(null);
      fail('Les deux codes ne correspondent pas. Recommencez.');
      return;
    }
    void save(pin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  // Après la confirmation verte : entrée dans l'application, sur le tableau de bord du rôle.
  useEffect(() => {
    if (!created) return;
    const timer = window.setTimeout(
      () => navigate(redirectTarget(location, created), { replace: true }),
      SUCCESS_DELAY,
    );
    return () => window.clearTimeout(timer);
  }, [created, location, navigate]);

  // Il faut un numéro prouvé par SMS, ou une session connectée sans PIN. Une fois le PIN
  // enregistré (`saved`), ces conditions ne tiennent plus : on reste pour la confirmation.
  const allowed = pendingPhone !== null || (status === 'authenticated' && needsPin);
  if (!allowed && !created && !saved.current) {
    return <Navigate to={user ? redirectTarget(location, user) : '/connexion'} replace />;
  }

  async function save(value: string) {
    setSaving(true);
    try {
      const signedIn = await authService.setPin(value);
      // Noté avant de mettre à jour la session, qui fait aussitôt redessiner l'écran.
      saved.current = signedIn;
      const store = useAuthStore.getState();
      store.setPendingPhone(null);
      store.setUser(signedIn);
      store.setNeedsPin(false);
      store.setLocked(false);
      rememberAccount({ phone: signedIn.phone, firstName: signedIn.firstName });
      setCreated(signedIn);
    } catch (err) {
      setFirst(null);
      fail(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (created ?? saved.current) {
    return (
      <AuthScreen title="Code PIN créé" subtitle="Bienvenue dans votre espace.">
        <div
          role="status"
          className="flex items-center justify-center gap-3 rounded-[12px] bg-auth-mint px-4 py-4 text-[15px] font-semibold text-auth-ink"
        >
          <CheckCircle2 className="h-6 w-6 text-[#1E7A45]" aria-hidden="true" />
          Votre code PIN est enregistré.
        </div>
      </AuthScreen>
    );
  }

  return (
    // La clé change entre le choix et la confirmation : l'écran glisse de nouveau.
    <AuthScreen
      key={confirming ? 'confirm' : 'choose'}
      title={confirming ? 'Confirmez votre code PIN' : 'Créez votre code PIN'}
      subtitle={
        confirming ? 'Saisissez-le une seconde fois.' : 'Il vous servira à ouvrir l’application.'
      }
      step={resetting ? undefined : { current: 3, total: 3 }}
    >
      <div className="flex flex-col gap-5">
        <PinPad
          value={pin}
          onChange={(value) => {
            setPin(value);
            if (error && value.length > 0) setError(undefined);
          }}
          disabled={saving}
          shakeKey={shakeKey}
          invalid={Boolean(error) && pin.length === 0}
        />
        <AuthError>{error}</AuthError>
      </div>
    </AuthScreen>
  );
}
