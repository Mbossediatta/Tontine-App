import { useState } from 'react';
import { Button, Modal, Select } from '@/components/ui';
import { fullName, plural } from '@/lib/format';
import { useAction } from '@/lib/query';
import { paymentService } from '@/services';
import type { RoundPaymentRow } from '@/types';

interface CashPaymentDialogProps {
  open: boolean;
  onClose: () => void;
  roundId: string;
  rows: RoundPaymentRow[];
}

/** Enregistrement d'un paiement reçu en espèces par l'administrateur. */
export function CashPaymentDialog({ open, onClose, roundId, rows }: CashPaymentDialogProps) {
  const [userId, setUserId] = useState('');
  const unpaid = rows.filter((row) => row.status !== 'paid');
  const record = useAction({
    action: (id: string) => paymentService.recordCash(roundId, id),
    success: 'Paiement en espèces enregistré',
    onSuccess: () => {
      setUserId('');
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
            disabled={!userId}
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
      )}
    </Modal>
  );
}
