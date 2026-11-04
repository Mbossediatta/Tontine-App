import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { OnlineButton } from '@/components/layout/OnlineButton';
import { Input, Modal, PhoneInput } from '@/components/ui';
import { useAction } from '@/lib/query';
import { adminSchema, type AdminValues } from '@/lib/validators';
import { adminService, memberService } from '@/services';
import type { User } from '@/types';

interface AccountFormDialogProps {
  open: boolean;
  onClose: () => void;
  /** admin : nomme un administrateur · member : crée un compte participant. */
  kind: 'admin' | 'member';
  /** Administrateur à modifier ; absent : création. */
  account?: User;
}

const EMPTY: AdminValues = { firstName: '', lastName: '', phone: '' };

const TEXTS = {
  admin: {
    create: 'Nouvel administrateur',
    submit: 'Créer l’administrateur',
    success: 'Administrateur créé',
  },
  member: { create: 'Nouveau membre', submit: 'Créer le membre', success: 'Membre créé' },
} as const;

/**
 * Création d'un compte (administrateur ou membre) ou modification d'un administrateur :
 * prénom, nom, numéro. Un compte créé ici n'a pas encore de PIN : à sa 1re connexion,
 * la personne reçoit un code par SMS puis crée son PIN.
 */
export function AccountFormDialog({ open, onClose, kind, account }: AccountFormDialogProps) {
  const editing = account !== undefined;
  const navigate = useNavigate();
  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AdminValues>({ resolver: zodResolver(adminSchema), defaultValues: EMPTY });

  // Pré-remplit le formulaire à chaque ouverture (vide en création).
  useEffect(() => {
    if (open) {
      reset(
        account
          ? { firstName: account.firstName, lastName: account.lastName, phone: account.phone }
          : EMPTY,
      );
    }
  }, [open, account, reset]);

  const save = useAction({
    action: async (values: AdminValues) => {
      if (account) return adminService.updateAdmin(account.id, values);
      if (kind === 'admin') return adminService.createAdmin(values);
      // Nouveau membre : on ouvre directement sa fiche.
      navigate(`/admin/membres/${await memberService.create(values)}`);
    },
    success: editing ? 'Modifications enregistrées' : TEXTS[kind].success,
    onSuccess: onClose,
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Modifier l’administrateur' : TEXTS[kind].create}
    >
      <form
        onSubmit={handleSubmit((values) => save.mutate(values))}
        className="flex flex-col gap-4"
        noValidate
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Prénom"
            autoComplete="off"
            error={errors.firstName?.message}
            {...register('firstName')}
          />
          <Input
            label="Nom"
            autoComplete="off"
            error={errors.lastName?.message}
            {...register('lastName')}
          />
        </div>
        <Controller
          control={control}
          name="phone"
          render={({ field }) => (
            <PhoneInput
              label="Numéro de téléphone"
              hint={
                editing
                  ? undefined
                  : 'À sa 1re connexion, la personne recevra un code par SMS puis créera son PIN.'
              }
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              error={errors.phone?.message}
            />
          )}
        />
        <OnlineButton type="submit" variant="blue" loading={save.isPending} className="w-full">
          {editing ? 'Enregistrer' : TEXTS[kind].submit}
        </OnlineButton>
      </form>
    </Modal>
  );
}
