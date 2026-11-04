import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, startOfMonth } from 'date-fns';
import { Card, CardTitle, Input } from '@/components/ui';
import { financeService } from '@/services';
import { QueryState, Stat } from './PlatformUi';
import { money } from './labels';

/** Rapprochement du mois choisi entre l'application et le relevé du service de paiement. */
export function ReconciliationCard() {
  const [month, setMonth] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const reconciliation = useQuery({
    queryKey: ['admin', 'reconciliation', month],
    queryFn: () => financeService.reconciliation(month),
  });

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <CardTitle>Réconciliation</CardTitle>
          <p className="mt-1 text-label text-muted">
            Compare les encaissements de l’application au relevé du service de paiement.
          </p>
        </div>
        <Input
          label="Mois"
          type="month"
          value={month.slice(0, 7)}
          onChange={(event) => setMonth(`${event.target.value}-01`)}
        />
      </div>
      <QueryState query={reconciliation}>
        {reconciliation.data ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat
                label="Attendu"
                className="col-span-2 sm:col-span-1"
                value={money(reconciliation.data.expected)}
              />
              <Stat label="Enregistré en ligne" value={money(reconciliation.data.recordedOnline)} />
              <Stat label="Relevé prestataire" value={money(reconciliation.data.provider)} />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat
                label="Espèces déclarées"
                className="col-span-2 sm:col-span-1"
                value={money(reconciliation.data.recordedCash)}
              />
              <Stat label="Transactions rapprochées" value={reconciliation.data.matched} />
              <Stat
                label="Écarts à vérifier"
                value={reconciliation.data.providerOnly.length + reconciliation.data.appOnly.length}
              />
            </div>
            {reconciliation.data.providerOnly.length || reconciliation.data.appOnly.length ? (
              <div className="rounded-control bg-warning-bg p-3 text-label text-warning">
                <strong>Écarts détectés :</strong> {reconciliation.data.providerOnly.length}{' '}
                encaissement(s) absents de l’application et {reconciliation.data.appOnly.length}{' '}
                paiement(s) absents du relevé.
              </div>
            ) : (
              <p className="rounded-control bg-green-100 p-3 font-bold text-green-700">
                Aucun écart pour cette période.
              </p>
            )}
          </>
        ) : null}
      </QueryState>
    </Card>
  );
}
