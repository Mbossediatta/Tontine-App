import { Link } from 'react-router-dom';
import { useAction } from '@/lib/query';
import { formatDate } from '@/lib/format';
import { roundService } from '@/services';
import type { RoundView } from '@/types';
import { AmountDisplay } from '../ui/AmountDisplay';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

const METHODS = { wave: 'Wave', orange_money: 'Orange Money' } as const;

/**
 * Ma cagnotte validée : en attente d'envoi, ou envoyée (je confirme la réception, ou je
 * signale que je n'ai rien reçu).
 */
export function PayoutReceiptCard({
  view,
  userId,
  groupId,
}: {
  view: RoundView;
  userId: string;
  groupId: string;
}) {
  const { round } = view;
  const transfer = round.transfers?.[userId];
  const amount = round.beneficiaryAmounts?.[userId] ?? 0;
  const confirm = useAction({
    action: () => roundService.confirmPayoutReceived(round.id),
    success: 'Merci ! Réception confirmée',
  });
  if (transfer?.receivedAt) return null;

  return (
    <Card className="flex flex-col gap-2 border-green-300 bg-green-50 px-4 py-3">
      <p className="text-[15px] font-semibold text-green-900">
        Ta cagnotte du tour {round.number} : <AmountDisplay value={amount} />
      </p>
      {transfer ? (
        <>
          <p className="text-[13px] text-green-900">
            Envoyée par {METHODS[transfer.method]} le {formatDate(transfer.sentAt)} (réf.{' '}
            {transfer.ref}). Vérifie ton compte puis confirme.
          </p>
          <Button block loading={confirm.isPending} onClick={() => confirm.mutate()}>
            J’ai bien reçu l’argent
          </Button>
          <Link
            to={`/reclamation?groupe=${groupId}&tour=${round.id}&motif=payout`}
            className="text-center text-[13px] font-semibold text-blue-700 underline"
          >
            Je n’ai rien reçu
          </Link>
        </>
      ) : (
        <p className="text-[13px] text-green-900">
          Elle est validée : ton administrateur va te l’envoyer sur ton numéro de reversement.
        </p>
      )}
    </Card>
  );
}
