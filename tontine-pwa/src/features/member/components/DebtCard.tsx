import { useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '@/lib/errors';
import { markPaymentRedirect } from '@/lib/paymentRedirect';
import { paymentService } from '@/services';
import type { DebtView } from '@/types';
import { AmountDisplay } from '../ui/AmountDisplay';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

/**
 * Mes impayés dans ce groupe (cagnotte versée sans ma cotisation) : je les rembourse en ligne,
 * sinon ils sont retenus sur ma cagnotte à mon tour.
 */
export function DebtCard({ debts }: { debts: DebtView[] }) {
  const [paying, setPaying] = useState<string | null>(null);
  if (debts.length === 0) return null;

  const pay = async (debtId: string, method: 'wave' | 'orange_money') => {
    setPaying(`${debtId}:${method}`);
    try {
      const { checkoutUrl } = await paymentService.payDebt(debtId, method);
      // Page sécurisée du service de paiement ; le retour ne redemande pas le PIN.
      markPaymentRedirect();
      window.location.assign(checkoutUrl);
    } catch (error) {
      toast.error(errorMessage(error));
      setPaying(null);
    }
  };

  return (
    <Card className="flex flex-col gap-3 border-amber-300 bg-amber-50 px-4 py-3">
      <div>
        <p className="text-[15px] font-semibold text-amber-900">Impayés à rembourser</p>
        <p className="text-[13px] text-amber-900">
          Ces cagnottes ont été versées sans ta cotisation. Rembourse en ligne ; sinon ce montant
          sera retenu sur ta cagnotte.
        </p>
      </div>
      {debts.map(({ debt, roundNumber }) => (
        <div key={debt.id} className="flex flex-col gap-2 border-t border-amber-200 pt-2">
          <p className="text-[15px] font-semibold text-amber-900">
            Tour {roundNumber} : <AmountDisplay value={debt.amount + debt.penaltyAmount} />
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              loading={paying === `${debt.id}:wave`}
              disabled={paying !== null}
              onClick={() => void pay(debt.id, 'wave')}
            >
              Wave
            </Button>
            <Button
              variant="secondary"
              loading={paying === `${debt.id}:orange_money`}
              disabled={paying !== null}
              onClick={() => void pay(debt.id, 'orange_money')}
            >
              Orange Money
            </Button>
          </div>
        </div>
      ))}
    </Card>
  );
}
