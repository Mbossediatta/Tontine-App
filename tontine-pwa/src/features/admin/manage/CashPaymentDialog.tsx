import { useState } from 'react';
import { Button, Input, Modal, Select } from '@/components/ui';
import { fullName, plural } from '@/lib/format';
import { useAction } from '@/lib/query';
import { paymentService } from '@/services';
import type { Group, RoundPaymentRow } from '@/types';

interface CashPaymentDialogProps {
  open: boolean;
  onClose: () => void;
  roundId: string;
  rows: RoundPaymentRow[];
  group: Group;
}

const PERIOD_WORDS: Record<Group['frequency'], string> = {
  daily: 'jours',
  weekly: 'semaines',
  biweekly: 'quinzaines',
  monthly: 'mois',
};

/** Enregistrement d'un paiement reçu en espèces par l'administrateur. */
export function CashPaymentDialog({ open, onClose, roundId, rows, group }: CashPaymentDialogProps) {
  const [userId, setUserId] = useState('');
  // Versement en espèces de quelques jours (ou périodes) ; vide : tout le reste du tour.
  const [periods, setPeriods] = useState('');
  const count = periods.trim() === '' ? undefined : Number(periods);
  const invalid = count !== undefined && (!Number.isInteger(count) || count < 1);
  const unpaid = rows.filter((row) => row.status !== 'paid');
  const record = useAction({
    action: (id: string) => paymentService.recordCash(roundId, id, count),
    success: 'Paiement en espèces enregistré',
    onSuccess: () => {
      setUserId('');
      setPeriods('');
      onClose();
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Paiement en espèces"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="primary"
            disabled={!userId || invalid}
            loading={record.isPending}
            onClick={() => record.mutate(userId)}
          >
            Enregistrer
          </Button>
        </>
      }
    >
      {unpaid.length === 0 ? (
        <p className="text-muted">Tous les membres ont payé ce tour.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <Select
            label="Membre qui a payé"
            placeholder="Choisir un membre"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            options={unpaid.map((row) => ({
              value: row.user.id,
              label: `${fullName(row.user)} · ${plural(row.shareCount, 'part')}`,
            }))}
          />
          {group.turnLength > 1 ? (
            <Input
              label={`Nombre de ${PERIOD_WORDS[group.frequency]} payés`}
              hint={`Laissez vide pour tout le reste du tour (${group.turnLength} ${PERIOD_WORDS[group.frequency]} au total).`}
              type="number"
              min={1}
              max={group.turnLength}
              inputMode="numeric"
              value={periods}
              onChange={(event) => setPeriods(event.target.value)}
              error={invalid ? 'Indiquez un nombre entier, au moins 1.' : undefined}
            />
          ) : null}
        </div>
      )}
    </Modal>
  );
}
