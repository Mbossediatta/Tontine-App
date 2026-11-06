import { useState } from 'react';
import { HandCoins } from 'lucide-react';
import { AmountText } from '@/components/domain';
import { OnlineButton } from '@/components/layout/OnlineButton';
import { Card, CardTitle, ConfirmDialog } from '@/components/ui';
import { useDebts } from '@/features/groups/queries';
import { formatDate, fullName } from '@/lib/format';
import { useAction } from '@/lib/query';
import { paymentService } from '@/services';
import type { DebtView } from '@/types';

/**
 * Impayés du groupe : ce que des membres n'avaient pas versé quand la cagnotte d'un tour a
 * été versée sans eux. Remboursés en espèces, ou retenus sur leur propre cagnotte.
 */
export function DebtsCard({ groupId }: { groupId: string }) {
  const query = useDebts(groupId);
  const [toSettle, setToSettle] = useState<DebtView | null>(null);
  const settle = useAction({
    action: (debtId: string) => paymentService.recordDebtPayment(debtId),
    success: 'Remboursement enregistré',
    onSuccess: () => setToSettle(null),
  });
  const open = (query.data ?? []).filter(({ debt }) => debt.status === 'open');
  if (open.length === 0) return null;

  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>Impayés à rembourser</CardTitle>
      <p className="text-label text-muted">
        Sans remboursement, chaque impayé sera retenu sur la cagnotte du membre à son tour.
      </p>
      <ul className="flex flex-col divide-y divide-line">
        {open.map((view) => {
          const { debt, user, roundNumber } = view;
          return (
            <li key={debt.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold text-ink">{fullName(user)}</p>
                <p className="text-label text-muted">
                  Tour {roundNumber} · depuis le {formatDate(debt.createdAt)}
                  {debt.penaltyAmount > 0 ? (
                    <>
                      {' '}
                      · dont <AmountText value={debt.penaltyAmount} /> de pénalité
                    </>
                  ) : null}
                </p>
              </div>
              <AmountText
                value={debt.amount + debt.penaltyAmount}
                className="font-bold text-danger"
              />
              <OnlineButton
                size="sm"
                variant="secondary"
                onClick={() => setToSettle(view)}
                icon={<HandCoins className="h-4 w-4" aria-hidden="true" />}
              >
                Remboursé en espèces
              </OnlineButton>
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={toSettle !== null}
        onClose={() => setToSettle(null)}
        onConfirm={() => toSettle && settle.mutate(toSettle.debt.id)}
        loading={settle.isPending}
        title="Enregistrer le remboursement ?"
        confirmLabel="Enregistrer"
      >
        {toSettle ? (
          <p>
            {fullName(toSettle.user)} vous a remboursé{' '}
            <AmountText value={toSettle.debt.amount + toSettle.debt.penaltyAmount} /> en espèces
            pour le tour {toSettle.roundNumber}. La cotisation est à reverser aux bénéficiaires de
            ce tour.
          </p>
        ) : null}
      </ConfirmDialog>
    </Card>
  );
}
