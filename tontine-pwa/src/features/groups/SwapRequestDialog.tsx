import { useState } from 'react';
import { ConfirmDialog, Select } from '@/components/ui';
import { formatDate, fullName } from '@/lib/format';
import { useAction } from '@/lib/query';
import { swapService } from '@/services';
import type { RoundView } from '@/types';

interface SwapRequestDialogProps {
  /** Tour d'un autre membre que je voudrais prendre. */
  target: RoundView;
  /** Mes tours à venir, que je peux céder en échange. */
  myRounds: RoundView[];
  myUserId: string;
  onClose: () => void;
}

/** Demande d'échange : l'autre membre accepte, puis un administrateur du groupe valide. */
export function SwapRequestDialog({ target, myRounds, myUserId, onClose }: SwapRequestDialogProps) {
  // Plusieurs bénéficiaires possibles par tour : on choisit avec qui échanger. Pour un
  // membre, le tour d'un autre est anonyme : le serveur retrouve son bénéficiaire.
  const partners = target.beneficiaries.filter(
    (person, index, all) =>
      person.id !== myUserId && all.findIndex((other) => other.id === person.id) === index,
  );
  const offers = myRounds.filter((view) => view.round.id !== target.round.id);
  const [partnerId, setPartnerId] = useState(partners[0]?.id ?? '');
  const [myRoundId, setMyRoundId] = useState(offers[0]?.round.id ?? '');
  const partner = partners.find((person) => person.id === partnerId);
  const mine = offers.find((view) => view.round.id === myRoundId)?.round;

  const request = useAction({
    action: () => swapService.request(myRoundId, target.round.id, partnerId || undefined),
    success: 'Demande d’échange envoyée',
    onSuccess: onClose,
  });

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={() => request.mutate()}
      loading={request.isPending}
      tone="blue"
      title="Proposer un échange de tour"
      confirmLabel="Envoyer la demande"
    >
      <div className="flex flex-col gap-3">
        {partners.length > 1 ? (
          <Select
            label="Avec qui"
            value={partnerId}
            onChange={(event) => setPartnerId(event.target.value)}
            options={partners.map((person) => ({ value: person.id, label: fullName(person) }))}
          />
        ) : null}
        {offers.length > 1 ? (
          <Select
            label="Votre tour à céder"
            value={myRoundId}
            onChange={(event) => setMyRoundId(event.target.value)}
            options={offers.map(({ round }) => ({
              value: round.id,
              label: `Tour ${round.number} · ${formatDate(round.dueDate)}`,
            }))}
          />
        ) : null}
        {mine ? (
          <p>
            Vous recevriez la cagnotte au tour {target.round.number} (
            {formatDate(target.round.dueDate)}) au lieu du tour {mine.number} (
            {formatDate(mine.dueDate)}). {partner ? fullName(partner) : 'Le membre de ce tour'} doit
            accepter, puis un administrateur du groupe valide l’échange.
          </p>
        ) : null}
      </div>
    </ConfirmDialog>
  );
}
