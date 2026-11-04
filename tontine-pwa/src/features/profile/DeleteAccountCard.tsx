import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { OnlineButton } from '@/components/layout/OnlineButton';
import { Card, CardTitle, ConfirmDialog } from '@/components/ui';
import { useAuthStore } from '@/hooks/useAuth';
import { errorMessage } from '@/lib/errors';
import { authService } from '@/services';

/** Suppression du compte (droit à l'effacement des données personnelles). */
export function DeleteAccountCard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const remove = useMutation({
    mutationFn: () => authService.deleteAccount(),
    onSuccess: () => {
      queryClient.clear();
      useAuthStore.getState().setUser(null);
      toast.success('Votre compte a été supprimé');
      navigate('/connexion', { replace: true });
    },
    onError: (error) => {
      setOpen(false);
      toast.error(errorMessage(error));
    },
  });

  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>Supprimer mon compte</CardTitle>
      <p className="text-label text-muted">
        Vos nom, téléphone, photo et numéro de reversement seront effacés. Les paiements déjà
        effectués restent dans l’historique des groupes, sous le nom « Compte supprimé ». Ce n’est
        pas possible pendant une tontine en cours.
      </p>
      <OnlineButton
        variant="danger"
        block
        onClick={() => setOpen(true)}
        icon={<Trash2 className="h-5 w-5" aria-hidden="true" />}
      >
        Supprimer mon compte
      </OnlineButton>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        tone="danger"
        title="Supprimer définitivement votre compte ?"
        confirmLabel="Supprimer mon compte"
        confirmText="supprimer"
      >
        Cette action est irréversible. Vous serez déconnecté et ne pourrez plus accéder à vos
        groupes.
      </ConfirmDialog>
    </Card>
  );
}
