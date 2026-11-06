import { useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AmountText, PayButton } from '@/components/domain';
import { PageHeader } from '@/components/layout/PageHeader';
import { AsyncContent, EmptyState, Select } from '@/components/ui';
import { useGroup } from '@/features/groups/queries';
import { errorMessage } from '@/lib/errors';
import { formatAmount, formatDate } from '@/lib/format';
import { dueTimeLabel } from '@/lib/tontine';
import { installmentOf, periodsLabel, periodsLeft } from './installments';
import { paymentService } from '@/services';
import { PaymentMethodPicker, type OnlineMethod } from './PaymentMethodPicker';
import { markPaymentRedirect } from '@/lib/paymentRedirect';

export default function PayPage() {
  const { id = '' } = useParams();
  const query = useGroup(id);
  const [method, setMethod] = useState<OnlineMethod | null>('wave');
  const [submitting, setSubmitting] = useState(false);
  // Versement choisi : null = tout le reste du tour.
  const [periods, setPeriods] = useState<number | null>(null);

  return (
    <>
      <PageHeader title="Payer" backTo={`/groupes/${id}`} />
      <AsyncContent query={query}>
        {(overview) => {
          const { group, currentRound, myStatus } = overview;
          if (!currentRound || currentRound.status !== 'open' || !myStatus || myStatus === 'paid') {
            return (
              <EmptyState
                title="Rien à payer"
                description="Vous êtes à jour pour ce groupe."
                action={
                  <Link to={`/groupes/${id}`} className="font-bold text-blue-700 underline">
                    Retour au groupe
                  </Link>
                }
              />
            );
          }
          // Paiement par versements : tout le reste, ou quelques jours (ou périodes).
          const left = periodsLeft(overview);
          const part = installmentOf(overview, periods);
          const penalty = part.penalty;
          // Frais du service de paiement (PayTech) payés par le membre, en plus.
          const total = part.total;

          const pay = async () => {
            if (!method) {
              toast.error('Choisissez un moyen de paiement.');
              return;
            }
            setSubmitting(true);
            try {
              const { checkoutUrl } = await paymentService.initiatePayment({
                roundId: currentRound.id,
                method,
                periods: periods ?? undefined,
              });
              markPaymentRedirect(); // pas de PIN redemandé au retour du paiement
              window.location.assign(checkoutUrl);
            } catch (error) {
              toast.error(errorMessage(error));
              setSubmitting(false);
            }
          };

          return (
            <div className="flex flex-col gap-6">
              <section className="flex flex-col items-center gap-2 py-2 text-center">
                <p className="text-label text-muted">Votre cotisation</p>
                <AmountText value={total} tone="due" size="main" />
                <p className="text-label text-muted">
                  {group.name} · tour {currentRound.number}
                  {penalty > 0 ? (
                    <>
                      {' '}
                      · dont pénalité <AmountText value={penalty} />
                    </>
                  ) : null}
                  {part.serviceFee > 0 ? (
                    <>
                      {' '}
                      · dont frais de paiement <AmountText value={part.serviceFee} />
                    </>
                  ) : null}
                </p>
                <span className="inline-flex items-center gap-1 rounded-pill bg-warning-bg px-3 py-1 text-small font-bold text-warning">
                  <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                  Avant le {formatDate(currentRound.dueDate)}
                  {dueTimeLabel(group.paymentDueTime)}
                </span>
              </section>
              {left > 1 ? (
                <Select
                  label="Montant à payer"
                  value={periods === null ? 'all' : String(periods)}
                  onChange={(event) =>
                    setPeriods(event.target.value === 'all' ? null : Number(event.target.value))
                  }
                  options={[
                    {
                      value: 'all',
                      label: `Tout le reste (${periodsLabel(group.frequency, left)}) — ${formatAmount(installmentOf(overview, null).contribution)}`,
                    },
                    ...Array.from({ length: left - 1 }, (_, index) => index + 1).map((count) => ({
                      value: String(count),
                      label: `${periodsLabel(group.frequency, count)} — ${formatAmount(installmentOf(overview, count).contribution)}`,
                    })),
                  ]}
                />
              ) : null}
              <PaymentMethodPicker value={method} onChange={setMethod} />
              <div className="sticky bottom-20 bg-blue-50 py-2 lg:static">
                <PayButton amount={total} loading={submitting} onClick={() => void pay()} />
                <p className="mt-2 text-center text-small text-muted">
                  Vous serez redirigé vers la page de paiement sécurisée. Les frais de paiement sont
                  inclus dans le montant.
                </p>
              </div>
            </div>
          );
        }}
      </AsyncContent>
    </>
  );
}
