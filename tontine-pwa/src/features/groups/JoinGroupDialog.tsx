import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Modal } from '@/components/ui';
import { joinCodeSchema, type JoinCodeValues } from '@/lib/validators';

interface JoinGroupDialogProps {
  open: boolean;
  onClose: () => void;
}

/** Saisie d'un code d'invitation puis ouverture de l'aperçu du groupe. */
export function JoinGroupDialog({ open, onClose }: JoinGroupDialogProps) {
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<JoinCodeValues>({
    resolver: zodResolver(joinCodeSchema),
    defaultValues: { code: '' },
  });

  const close = () => {
    reset();
    onClose();
  };

  const onSubmit = ({ code }: JoinCodeValues) => {
    close();
    navigate(`/rejoindre/${encodeURIComponent(code.toUpperCase())}`);
  };

  return (
    <Modal open={open} onClose={close} title="Rejoindre un groupe">
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3" noValidate>
        <Input
          label="Code d’invitation"
          hint="Demandez ce code à l’administrateur du groupe."
          placeholder="Ex. FAM4K7"
          autoCapitalize="characters"
          autoComplete="off"
          autoFocus
          className="uppercase tracking-widest"
          error={errors.code?.message}
          {...register('code')}
        />
        <Button type="submit" variant="blue" className="w-full">
          Voir le groupe
        </Button>
      </form>
    </Modal>
  );
}
