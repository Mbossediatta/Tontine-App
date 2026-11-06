import { useState } from 'react';
import { Send } from 'lucide-react';
import { AmountText } from '@/components/domain';
import { OnlineButton } from '@/components/layout/OnlineButton';
import { Card, CardTitle, Input, Select } from '@/components/ui';
import { formatDate, formatPhone, fullName } from '@/lib/format';
import { useAction } from '@/lib/query';
import { roundService } from '@/services';
import type { PayoutMethod, PublicUser, RoundView } from '@/types';

const METHODS: Record<PayoutMethod, string> = { wave: 'Wave', orange_money: 'Orange Money' };

interface PendingTransfer {
  view: RoundView;
  user: PublicUser;
  amount: number;
}

/** Une cagnotte à envoyer : moyen, référence de la transaction, puis « Argent envoyé ». */
function TransferRow({ view, user, amount }: PendingTransfer) {
  const transfer = view.round.transfers?.[user.id];
  const [method, setMethod] = useState<PayoutMethod>(user.payoutMethod ?? 'wave');
  const [ref, setRef] = useState('');
  const send = useAction({
    action: () => roundService.markPayoutSent(view.round.id, user.id, method, ref),
    success: 'Envoi enregistré : le bénéficiaire va confirmer la réception',
  });

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-bold text-ink">
          {fullName(user)} · tour {view.round.number}
        </span>
        <AmountText value={amount} className="font-bold text-green-700" />
      </div>
      <p className="text-label text-muted">
        {user.payoutPhone
          ? `${formatPhone(user.payoutPhone)}${user.payoutMethod ? ` (${METHODS[user.payoutMethod]})` : ''}`
          : 'Numéro de reversement non renseigné'}
      </p>
      {transfer ? (
        <p className="text-label text-blue-700">
          Envoyé par {METHODS[transfer.method]} le {formatDate(transfer.sentAt)} · réf.{' '}
          {transfer.ref} · en attente de la confirmation du bénéficiaire
        </p>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Select
            label="Envoyé par"
            value={method}
            onChange={(event) => setMethod(event.target.value as PayoutMethod)}
            options={[
              { value: 'wave', label: 'Wave' },
              { value: 'orange_money', label: 'Orange Money' },
            ]}
          />
          <div className="flex-1">
            <Input
              label="Référence de la transaction"
              value={ref}
              maxLength={60}
              onChange={(event) => setRef(event.target.value)}
            />
          </div>
          <OnlineButton
            disabled={ref.trim().length < 3}
            loading={send.isPending}
            onClick={() => send.mutate()}
            icon={<Send className="h-4 w-4" aria-hidden="true" />}
          >
            Argent envoyé
          </OnlineButton>
        </div>
      )}
    </li>
  );
}

/**
 * Cagnottes validées dont l'argent reste à envoyer (ou dont le bénéficiaire n'a pas encore
 * confirmé la réception). L'envoi se fait par Wave ou Orange Money, puis on note la référence.
 */
export function TransfersCard({ rounds }: { rounds: RoundView[] }) {
  const pending: PendingTransfer[] = rounds
    .filter((view) => view.round.status === 'paid_out' && view.round.recipientType !== 'platform')
    .flatMap((view) =>
      view.beneficiaryShares.map(({ user, amount }) => ({
        view,
        user,
        amount: view.round.beneficiaryAmounts?.[user.id] ?? amount,
      })),
    )
    .filter(({ view, user }) => !view.round.transfers?.[user.id]?.receivedAt);
  if (pending.length === 0) return null;

  return (
    <Card className="flex flex-col gap-2">
      <CardTitle>Cagnottes à envoyer</CardTitle>
      <p className="text-label text-muted">
        Envoyez l’argent par Wave ou Orange Money au numéro du bénéficiaire, puis notez la référence
        de la transaction. Le bénéficiaire confirmera la réception.
      </p>
      <ul className="flex flex-col divide-y divide-line">
        {pending.map((item) => (
          <TransferRow key={`${item.view.round.id}-${item.user.id}`} {...item} />
        ))}
      </ul>
    </Card>
  );
}
