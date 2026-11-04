import { Download, Gift } from 'lucide-react';
import { AmountText, StatusBadge } from '@/components/domain';
import { AsyncContent, Card, CardTitle, EmptyState } from '@/components/ui';
import { downloadPaymentReceipt, downloadPayoutReceipt } from '@/features/payments/receipts';
import { useCurrentUser } from '@/hooks/useAuth';
import { formatDate, fullName, paymentMethodLabel } from '@/lib/format';
import { useGroup, useMyHistory } from '../queries';

const receiptButton =
  'flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-blue-700 transition-colors duration-150 hover:bg-blue-100';

/** Mes paiements et les cagnottes reçues, avec leurs reçus PDF. */
export function HistoryTab({ groupId }: { groupId: string }) {
  const user = useCurrentUser();
  const query = useMyHistory(groupId);
  const groupName = useGroup(groupId).data?.group.name ?? '';
  const multiCycle = (useGroup(groupId).data?.group.currentCycle ?? 1) > 1;
  const tourLabel = (cycle: number, round: number) =>
    multiCycle ? `Cycle ${cycle} · tour ${round}` : `Tour ${round}`;

  return (
    <AsyncContent query={query}>
      {({ payments, received }) => (
        <div className="flex flex-col gap-3">
          {received.map((round) => {
            const amount = round.beneficiaryAmounts?.[user.id] ?? round.potAmount;
            return (
              <Card key={round.id} tone="positive" className="flex items-center gap-3">
                <Gift className="h-6 w-6 shrink-0 text-green-700" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-ink">
                    Cagnotte reçue · {tourLabel(round.cycle, round.number).toLowerCase()}
                  </p>
                  <p className="text-label text-muted">
                    {round.paidOutAt ? formatDate(round.paidOutAt) : '—'}
                  </p>
                </div>
                <AmountText value={amount} tone="received" className="font-bold" />
                {round.paidOutAt ? (
                  <button
                    type="button"
                    className={receiptButton}
                    aria-label={`Télécharger l’attestation du tour ${round.number}`}
                    onClick={() =>
                      downloadPayoutReceipt({
                        roundId: round.id,
                        beneficiaryName: fullName(user),
                        groupName,
                        cycle: round.cycle,
                        roundNumber: round.number,
                        amount,
                        paidOutAt: round.paidOutAt ?? '',
                        payoutPhone: user.payoutPhone,
                        payoutMethod: user.payoutMethod,
                      })
                    }
                  >
                    <Download className="h-5 w-5" aria-hidden="true" />
                  </button>
                ) : null}
              </Card>
            );
          })}
          {payments.length === 0 ? (
            <EmptyState title="Aucun paiement pour l’instant" />
          ) : (
            <Card padded={false} className="px-4">
              <CardTitle className="pt-4">Mes paiements</CardTitle>
              <ul className="divide-y divide-line">
                {payments.map(({ payment, roundNumber, cycle }) => (
                  <li key={payment.id} className="flex flex-wrap items-center gap-2 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-ink">
                        {tourLabel(cycle, roundNumber)} · {paymentMethodLabel(payment.method)}
                      </p>
                      <p className="text-label text-muted">
                        {payment.paidAt ? formatDate(payment.paidAt) : 'En cours'}
                        {payment.providerRef ? ` · Réf. ${payment.providerRef}` : ''}
                      </p>
                    </div>
                    <AmountText value={payment.amount} className="font-bold" />
                    <StatusBadge status={payment.status} />
                    {payment.status === 'paid' && payment.paidAt ? (
                      <button
                        type="button"
                        className={receiptButton}
                        aria-label={`Télécharger le reçu du tour ${roundNumber}`}
                        onClick={() =>
                          downloadPaymentReceipt({
                            paymentId: payment.id,
                            payerName: fullName(user),
                            payerPhone: user.phone,
                            groupName,
                            cycle,
                            roundNumber,
                            amount: payment.amount,
                            method: payment.method,
                            providerRef: payment.providerRef,
                            paidAt: payment.paidAt ?? '',
                          })
                        }
                      >
                        <Download className="h-5 w-5" aria-hidden="true" />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </AsyncContent>
  );
}
