import { useNavigate } from 'react-router-dom';
import { AmountText, PayButton, RoundProgress, StatusBadge } from '@/components/domain';
import { Avatar, Card, EmptyState } from '@/components/ui';
import { useCurrentUser } from '@/hooks/useAuth';
import { formatDate, formatRelative, fullName } from '@/lib/format';
import type { GroupOverview } from '@/types';

export function CurrentRoundTab({ overview }: { overview: GroupOverview }) {
  const navigate = useNavigate();
  const user = useCurrentUser();
  const { group, currentRound, currentBeneficiary, paidCount, activeMemberCount, activeShareCount, myStatus } =
    overview;

  if (group.status === 'draft') {
    return (
      <EmptyState
        title="Le cycle n’a pas encore démarré"
        description={`${activeMemberCount} personne(s) · ${activeShareCount} part(s) sur ${group.maxMembers}. L’administrateur lancera le premier tour quand toutes les parts seront attribuées.`}
      />
    );
  }
  if (!currentRound) {
    return (
      <EmptyState
        title="Cycle terminé"
        description="Tous les membres ont reçu la cagnotte. Consultez l’historique."
      />
    );
  }

  const iAmBeneficiary =
    currentRound.recipientType !== 'platform' &&
    overview.currentBeneficiaries.some((beneficiary) => beneficiary.id === user.id);
  const platformPeriod = currentRound.recipientType === 'platform';

  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-col gap-3">
        <h2 className="text-section text-blue-900">
          Période {currentRound.number} sur {overview.totalRounds}
        </h2>
        {platformPeriod ? (
          <div className="rounded-control bg-blue-50 p-3 text-label text-muted">
            Période de cotisation de la plateforme.
          </div>
        ) : (
          <div className="flex items-center gap-3">
            {currentBeneficiary ? (
              <Avatar name={fullName(currentBeneficiary)} src={currentBeneficiary.avatarUrl} />
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="text-label text-muted">
                {overview.currentBeneficiaries.length > 1 ? 'Bénéficiaires' : 'Bénéficiaire'}
              </p>
              <p className="font-bold text-ink">
                {overview.currentBeneficiaries.length
                  ? overview.currentBeneficiaries
                      .map((beneficiary) =>
                        beneficiary.id === user.id ? 'Vous' : fullName(beneficiary),
                      )
                      .join(' · ')
                  : currentBeneficiary
                    ? fullName(currentBeneficiary)
                    : '—'}
              </p>
            </div>
            {iAmBeneficiary ? <StatusBadge status="my_turn" /> : null}
          </div>
        )}
        <div>
          <p className="text-label text-muted">Date limite</p>
          <p className="font-bold text-ink">
            {formatDate(currentRound.dueDate)}{' '}
            <span className="font-normal text-muted">({formatRelative(currentRound.dueDate)})</span>
          </p>
        </div>
        <RoundProgress paid={paidCount} total={activeShareCount} />
        {myStatus ? (
          <div className="flex items-center justify-between gap-2">
            <span className="text-label text-muted">Votre statut</span>
            <StatusBadge status={myStatus} />
          </div>
        ) : null}
        {overview.myMembershipFeeDue > 0 ? (
          <p className="text-label text-muted">
            Frais d’adhésion (une seule fois) :{' '}
            <AmountText value={overview.myMembershipFeeDue} /> · inclus dans votre prochain
            paiement.
          </p>
        ) : null}
        {currentRound.status === 'ready_for_payout' && !platformPeriod ? (
          <p className="rounded-control bg-green-100 p-3 text-label text-green-700">
            Tout le monde a payé : la cagnotte de <AmountText value={currentRound.potAmount} /> va
            être reversée.
          </p>
        ) : null}
      </Card>
      {myStatus && myStatus !== 'paid' && currentRound.status === 'open' ? (
        <div className="sticky bottom-24 lg:static">
          {overview.myPenalty > 0 ? (
            <p className="mb-2 text-label text-danger">
              Date limite dépassée : pénalité de <AmountText value={overview.myPenalty} /> incluse.
            </p>
          ) : myStatus === 'pending' && group.latePenalty ? (
            <p className="mb-2 text-small text-muted">
              Après la date limite, une pénalité de <AmountText value={group.latePenalty} /> sera
              ajoutée automatiquement.
            </p>
          ) : null}
          <PayButton
            amount={overview.myAmountDue}
            onClick={() => navigate(`/groupes/${group.id}/payer`)}
          />
        </div>
      ) : null}
    </div>
  );
}
