import { useEffect, useState, type ChangeEvent } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Camera, Trash2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { OnlineButton } from '@/components/layout/OnlineButton';
import { Avatar, Button, Input, Modal } from '@/components/ui';
import { useAuthStore, useCurrentUser } from '@/hooks/useAuth';
import { compressAvatar } from '@/lib/image';
import { useAction } from '@/lib/query';
import { profileSchema, type ProfileValues } from '@/lib/validators';
import { authService } from '@/services';

interface EditProfileDialogProps {
  open: boolean;
  onClose: () => void;
}

/** Modification du prénom, du nom et de la photo. */
export function EditProfileDialog({ open, onClose }: EditProfileDialogProps) {
  const user = useCurrentUser();
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl);
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { firstName: user.firstName, lastName: user.lastName },
  });

  useEffect(() => {
    if (!open) return;
    reset({ firstName: user.firstName, lastName: user.lastName });
    setAvatarUrl(user.avatarUrl);
  }, [open, reset, user.firstName, user.lastName, user.avatarUrl]);

  const save = useAction({
    action: (values: ProfileValues) =>
      authService.updateProfile({
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        avatarUrl,
      }),
    success: 'Profil mis à jour',
    onSuccess: (updated) => {
      useAuthStore.getState().setUser(updated);
      onClose();
    },
  });

  const onPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      setAvatarUrl(await compressAvatar(file));
    } catch {
      toast.error('Impossible de lire cette photo.');
    }
  };

  const name = `${watch('firstName')} ${watch('lastName')}`.trim() || '?';

  return (
    <Modal open={open} onClose={onClose} title="Modifier mon profil">
      <form
        onSubmit={handleSubmit((values) => save.mutate(values))}
        className="flex flex-col gap-4"
        noValidate
      >
        <div className="flex flex-col items-center gap-3">
          <Avatar name={name} src={avatarUrl} size="lg" />
          <div className="flex flex-wrap justify-center gap-2">
            <label className="inline-flex min-h-touch cursor-pointer items-center gap-2 rounded-control border-2 border-blue-700 px-4 text-label font-bold text-blue-700 focus-within:outline focus-within:outline-[3px] focus-within:outline-green-300 hover:bg-blue-100">
              <Camera className="h-4 w-4" aria-hidden="true" />
              {avatarUrl ? 'Changer la photo' : 'Ajouter une photo'}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => void onPhoto(e)}
              />
            </label>
            {avatarUrl ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAvatarUrl(undefined)}
                icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
              >
                Retirer la photo
              </Button>
            ) : null}
          </div>
        </div>
        <Input
          label="Prénom"
          autoComplete="given-name"
          error={errors.firstName?.message}
          {...register('firstName')}
        />
        <Input
          label="Nom"
          autoComplete="family-name"
          error={errors.lastName?.message}
          {...register('lastName')}
        />
        <p className="text-small text-muted">
          Pour changer de numéro de téléphone, créez un nouveau compte avec le nouveau numéro.
        </p>
        <OnlineButton type="submit" className="w-full" loading={save.isPending}>
          Enregistrer
        </OnlineButton>
      </form>
    </Modal>
  );
}
