import { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { AmountDisplay } from '@/features/member/ui/AmountDisplay';
import { Button } from '@/features/member/ui/Button';
import { Card } from '@/features/member/ui/Card';
import { errorMessage } from '@/lib/errors';
import { paymentMethodLabel } from '@/lib/format';
import { completeSimulatedCheckout, getSimulatedCheckout } from '@/services/mock/gateway';
import type { PaymentMethod } from '@/types';

/**
 * Page du service de paiement simulé (mode démonstration uniquement) : elle tient
 * la place de la page sécurisée de Wave ou d'Orange Money, où le membre valide
 * avec son code. Ici, on choisit simplement le résultat à simuler.
 */
export default function SimulationPage() {
  const [params] = useSearchParams();
  const paymentId = params.get('payment') ?? '';
  const query = useQuery({
    queryKey: ['simulation', paymentId],
    queryFn: () => getSimulatedCheckout(paymentId),
  });
  const [busy, setBusy] = useState<'success' | 'failure' | null>(null);
  const [error, setError] = useState<string>();

  const finish = async (success: boolean) => {
    setBusy(success ? 'success' : 'failure');
    try {
      await completeSimulatedCheckout(paymentId, success);
      const target = success ? '/paiement/succes' : '/paiement/echec';
      window.location.assign(`${target}?payment=${encodeURIComponent(paymentId)}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  };

  return (
    <main className="theme-member flex min-h-[100dvh] justify-center bg-slate-100 px-4 py-8 sm:items-center">
      <div className="flex w-full max-w-md flex-col gap-4">
        <p className="flex items-center justify-center gap-2 text-[13px] font-semibold text-slate-600">
          <FlaskConical className="h-4 w-4" aria-hidden="true" />
          Service de paiement simulé
        </p>
        {query.isPending ? (
          <Card className="h-56 motion-safe:animate-pulse" />
        ) : query.isError || !query.data ? (
          <Card className="px-6 py-8 text-center text-[15px]">Paiement introuvable.</Card>
        ) : (
          <Card className="flex flex-col gap-4 px-6 py-6 text-center">
            <p className="text-[15px] font-semibold">
              {paymentMethodLabel(query.data.method as PaymentMethod)}
            </p>
            <p className="text-[13px] text-slate-600">Paiement à « {query.data.groupName} »</p>
            <AmountDisplay value={query.data.amount} size="xl" />
            <Button block loading={busy === 'success'} disabled={busy !== null} onClick={() => void finish(true)}>
              Valider le paiement
            </Button>
            <Button
              block
              variant="secondary"
              loading={busy === 'failure'}
              disabled={busy !== null}
              onClick={() => void finish(false)}
            >
              Simuler un échec (solde insuffisant)
            </Button>
            {error ? (
              <p role="alert" className="text-[13px] font-semibold text-danger">
                {error}
              </p>
            ) : null}
          </Card>
        )}
      </div>
    </main>
  );
}
