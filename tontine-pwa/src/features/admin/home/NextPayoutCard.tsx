import { useState } from 'react';
import { formatAmount, formatDate, fullName } from '@/lib/format';
import { useOnline } from '@/hooks/useOnline';
import type { GroupOverview, RoundView } from '@/types';
import { PayoutDialog } from '../manage/PayoutDialog';

interface NextPayoutCardProps {
  overview: GroupOverview;
  /** Tour en cours, vu avec son bénéficiaire (nécessaire à la confirmation du versement). */
  round: RoundView;
}

/**
 * Carte bleue « Prochain versement » : qui reçoit la cagnotte, combien et quand.
 * Le bouton n'est actif que lorsque tous les membres ont payé (tour « prêt »).
 */
export function NextPayoutCard({ overview, round }: NextPayoutCardProps) {
  const [confirming, setConfirming] = useState(false);
  const online = useOnline();
  const ready = round.round.status === 'ready_for_payout';

  return (
    <section className="flex flex-col gap-3 rounded-card bg-blue-700 p-5 text-white shadow-card">
      <p className="text-label text-blue-100">Prochain versement</p>
      <p className="font-display text-section">
        {fullName(round.beneficiary)}
        {round.round.beneficiaryShareCount && round.round.beneficiaryShareCount > 1
          ? ` · part ${round.round.beneficiaryShareNumber}`
          : ''}
      </p>
      <p className="tabular-nums text-blue-100">
        Tour {round.round.number} · {formatAmount(round.round.potAmount)} ·{' '}
        {formatDate(round.round.dueDate)}
      </p>
      {/* Bouton blanc, texte bleu : lisible sur le fond bleu de la carte. */}
      <button
        type="button"
        disabled={!ready || !online}
        onClick={() => setConfirming(true)}
        className="min-h-button rounded-control bg-white px-4 font-bold text-blue-700 transition-colors duration-150 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        Valider le versement
      </button>
      {!ready ? (
        <p className="text-small text-blue-100">
          Possible quand toutes les parts auront payé ({overview.paidCount} /{' '}
          {overview.activeShareCount}).
        </p>
      ) : null}
      <PayoutDialog round={confirming ? round : null} onClose={() => setConfirming(false)} />
    </section>
  );
}
