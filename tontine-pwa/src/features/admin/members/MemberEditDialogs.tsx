import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { OnlineButton } from '@/components/layout/OnlineButton';
import { Input, Modal, Textarea } from '@/components/ui';
import { fullName } from '@/lib/format';
import { useAction } from '@/lib/query';
import { memberService } from '@/services';
import type { User } from '@/types';

/** Super admin : corriger le prénom et le nom d'un membre. */
export function EditMemberDialog({
  user,
  open,
  onClose,
}: {
  user: User;
  open: boolean;
  onClose: () => void;
}) {
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  useEffect(() => {
    if (open) {
      setFirstName(user.firstName);
      setLastName(user.lastName);
    }
  }, [open, user]);

  const save = useAction({
    action: () => memberService.update(user.id, firstName.trim(), lastName.trim()),
    success: 'Membre modifié',
    onSuccess: onClose,
  });
  const valid =
    firstName.trim().length >= 2 &&
    lastName.trim().length >= 2 &&
    (firstName.trim() !== user.firstName || lastName.trim() !== user.lastName);

  return (
    <Modal open={open} onClose={onClose} title="Modifier le membre">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <Input
          label="Prénom"
          value={firstName}
          onChange={(event) => setFirstName(event.target.value)}
          maxLength={40}
        />
        <Input
          label="Nom"
          value={lastName}
          onChange={(event) => setLastName(event.target.value)}
          maxLength={40}
        />
        <p className="text-small text-muted">
          Pour le numéro de téléphone, utilisez « Changer le numéro » (un code est envoyé au nouveau
          numéro).
        </p>
        <OnlineButton type="submit" variant="blue" loading={save.isPending} disabled={!valid}>
          Enregistrer
        </OnlineButton>
      </form>
    </Modal>
  );
}

/**
 * Super admin : supprimer le compte d'un membre. Le compte est anonymisé (« Compte
 * supprimé ») : ses paiements restent dans l'historique des groupes. Refusé par le
 * serveur tant qu'il a une tontine en cours, une dette ou un rôle d'organisation.
 */
export function DeleteMemberDialog({
  user,
  open,
  onClose,
}: {
  user: User;
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (open) {
      setReason('');
      setTyped('');
    }
  }, [open]);

  const remove = useAction({
    action: () => memberService.remove(user.id, reason.trim()),
    success: 'Compte supprimé',
    onSuccess: () => {
      onClose();
      navigate('/admin/membres', { replace: true });
    },
  });
  const expected = user.phone.slice(-4);

  return (
    <Modal open={open} onClose={onClose} title="Supprimer le compte">
      <div className="flex flex-col gap-4">
        <p className="text-label text-ink">
          Le compte de <strong>{fullName(user)}</strong> sera fermé et anonymisé : il ne pourra plus
          se connecter, son numéro sera libéré, et ses anciens paiements apparaîtront sous le nom «
          Compte supprimé » dans l’historique des groupes. Cette action est définitive.
        </p>
        <p className="rounded-control bg-amber-50 p-3 text-small text-ink">
          Impossible tant qu’il participe à une tontine en cours, qu’il doit de l’argent ou qu’il a
          un rôle dans une organisation. Pour une interruption temporaire, préférez « Bloquer le
          compte ».
        </p>
        <Textarea
          label="Motif de la suppression"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={200}
        />
        <Input
          label={`Pour confirmer, tapez les 4 derniers chiffres de son numéro (${expected.replace(/\d/g, '•')})`}
          inputMode="numeric"
          value={typed}
          onChange={(event) => setTyped(event.target.value.replace(/\D/g, '').slice(0, 4))}
        />
        <OnlineButton
          variant="danger"
          loading={remove.isPending}
          disabled={reason.trim().length < 3 || typed !== expected}
          onClick={() => remove.mutate()}
        >
          Supprimer définitivement
        </OnlineButton>
      </div>
    </Modal>
  );
}
