import { useRef } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, useAuthStore } from '@/hooks/useAuth';
import { errorMessage } from '@/lib/errors';
import { profileSchema, type ProfileValues } from '@/lib/validators';
import { authService } from '@/services';
import { AuthButton, AuthError } from './components/AuthButton';
import { AuthScreen } from './components/AuthScreen';
import { TextField } from './components/TextField';
import type { RedirectState } from './redirect';

/**
 * Numéro sans compte, prouvé par SMS : prénom et nom, puis création du PIN.
 * Compté dans l'étape 3 (« finaliser le compte ») pour garder une inscription en 3 étapes.
 */
export default function RegisterPage() {
  const { needsProfile } = useAuth();
  const done = useRef(false);
  const navigate = useNavigate();
  const location = useLocation();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { firstName: '', lastName: '' },
  });

  // On n'arrive ici qu'après le code SMS d'un numéro inconnu. `done` : profil enregistré,
  // on part vers le PIN (sans quoi ce garde renverrait à l'écran 1 entre-temps).
  if (!done.current && (!needsProfile || !useAuthStore.getState().pendingPhone)) {
    return <Navigate to="/connexion" replace />;
  }

  const onSubmit = async (values: ProfileValues) => {
    try {
      await authService.completeProfile(values);
      done.current = true;
      useAuthStore.getState().setNeedsProfile(false);
      const state: RedirectState = {
        ...(location.state as RedirectState | null),
        firstName: values.firstName.trim(),
      };
      navigate('/connexion/pin/nouveau', { replace: true, state });
    } catch (error) {
      setError('root', { message: errorMessage(error) });
    }
  };

  return (
    <AuthScreen
      title="Votre profil"
      subtitle="Votre nom sera visible par les membres de vos groupes."
      step={{ current: 3, total: 3 }}
    >
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
        <TextField
          label="Prénom"
          autoComplete="given-name"
          autoFocus
          error={errors.firstName?.message}
          {...register('firstName')}
        />
        <TextField
          label="Nom"
          autoComplete="family-name"
          error={errors.lastName?.message}
          {...register('lastName')}
        />
        <AuthError>{errors.root?.message}</AuthError>
        <AuthButton type="submit" loading={isSubmitting}>
          Continuer
        </AuthButton>
      </form>
    </AuthScreen>
  );
}
