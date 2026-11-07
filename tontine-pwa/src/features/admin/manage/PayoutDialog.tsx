import { AmountText } from '@/components/domain';
import { ConfirmDialog } from '@/components/ui';
import { formatPhone, fullName } from '@/lib/format';
import { useAction } from '@/lib/query';
import { roundService } from '@/services';
import type { RoundView } from '@/types';

const PAYOUT_LABELS = { wave: 'Wave', orange_money: 'Orange Money' } as const;

/** Confirmation du reversement : bénéficiaire, numéro de reversement et montant. */
export function PayoutDialog({ round, onClose }: { round: RoundView | null; onClose: () => void }) {
  const payout = useAction({
    action: (roundId: string) => roundService.payout(roundId),
    success: (result) =>
      result === 'pending_approval'
        ? 'Demande envoyée : le super admin doit valider ce versement (300 000 FCFA ou plus)'
        : 'Cagnotte reversée',
    onSuccess: onClose,
  });
  const beneficiary = round?.beneficiary;

  return (
    <ConfirmDialog
      open={round !== null}
      onClose={onClose}
      onConfirm={() => round && payout.mutate(round.round.id)}
      loading={payout.isPending}
      tone="primary"
      title="Reverser la cagnotte ?"
      confirmLabel="Confirmer le reversement"
    >
      {round && round.round.status !== 'ready_for_payout' ? (
        <p className="mb-3 rounded-control bg-amber-50 px-3 py-2 text-label text-amber-800">
          Tous les membres n’ont pas payé. Le bénéficiaire reçoit ce qui a été réellement collecté ;
          ce qui manque devient une dette des membres concernés, retenue sur leur cagnotte s’ils ne
          remboursent pas.
        </p>
      ) : null}
      {round && beneficiary ? (
        <dl className="flex flex-col gap-2">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Bénéficiaire(s)</dt>
            <dd className="text-right font-semibold">
              {round.beneficiaryShares.length
                ? round.beneficiaryShares
                    .map(
                      ({ user, shareCount, amount }) =>
                        `${fullName(user)} · ${shareCount} part(s) · ${amount.toLocaleString('fr-FR')} FCFA`,
                    )
                    .join(' ; ')
                : fullName(beneficiary)}
            </dd>
          </div>
          {round.beneficiaries.map((person) => (
            <div key={person.id} className="flex justify-between gap-4">
              <dt className="text-muted">{fullName(person)}</dt>
              <dd className="text-right font-semibold tabular-nums">
                {person.payoutPhone ? (
                  <>
                    {formatPhone(person.payoutPhone)}
                    {person.payoutMethod ? ` (${PAYOUT_LABELS[person.payoutMethod]})` : ''}
                  </>
                ) : (
                  <span className="text-danger">Non renseigné</span>
                )}
              </dd>
            </div>
          ))}
          <div className="flex justify-between gap-4 border-t border-line pt-2 text-card-title">
            <dt>{round.round.status === 'ready_for_payout' ? 'Montant' : 'Montant prévu'}</dt>
            <dd>
              <AmountText value={round.round.potAmount} className="font-bold text-green-700" />
            </dd>
          </div>
        </dl>
      ) : null}
    </ConfirmDialog>
  );
}
