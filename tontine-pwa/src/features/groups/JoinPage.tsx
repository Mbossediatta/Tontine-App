import { CheckCircle2, Clock, UserPlus } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { AmountText } from '@/components/domain';
import { OnlineButton } from '@/components/layout/OnlineButton';
import { PageHeader } from '@/components/layout/PageHeader';
import { AsyncContent, Card, CardTitle } from '@/components/ui';
import { frequencyLabel, groupContributionLabel } from '@/lib/format';
import { useAction } from '@/lib/query';
import { computePot } from '@/lib/tontine';
import { groupService } from '@/services';
import { useInvitePreview } from './queries';

export default function JoinPage() {
  const { code = '' } = useParams();
  const query = useInvitePreview(code);
  const join = useAction({
    action: () => groupService.requestJoin(code),
    success: 'Demande envoyée',
  });

  return (
    <>
      <PageHeader title="Rejoindre un groupe" backTo="/" />
      <AsyncContent query={query} errorMessage="Ce code d’invitation est inconnu ou a expiré.">
        {({
          group,
          communityName,
          placesLeft,
          adminNames,
          activeMemberCount,
          activeShareCount,
          myMembershipStatus,
        }) => (
          <div className="flex flex-col gap-3">
            <Card className="flex flex-col gap-3">
              <CardTitle>{group.name}</CardTitle>
              {communityName ? (
                <p className="text-label font-semibold text-blue-700">
                  Communauté · {communityName}
                </p>
              ) : null}
              {group.description ? <p className="text-muted">{group.description}</p> : null}
              <dl className="grid grid-cols-2 gap-3 text-label">
                <div>
                  <dt className="text-muted">Cotisation</dt>
                  <dd className="font-semibold text-ink">{groupContributionLabel(group)}</dd>
                </div>
                <div>
                  <dt className="text-muted">Durée d’un tour</dt>
                  <dd className="font-semibold text-ink">
                    {group.dailyContribution
                      ? `${group.turnDurationDays ?? 10} jours`
                      : frequencyLabel(group.frequency)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Cagnotte par tour</dt>
                  <dd className="font-semibold text-ink">
                    <AmountText
                      value={
                        group.dailyContribution
                          ? group.contributionAmount *
                            (group.turnDurationDays ?? 10) *
                            group.maxMembers
                          : computePot(group.contributionAmount, group.maxMembers)
                      }
                    />
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Places restantes</dt>
                  <dd className="font-semibold tabular-nums text-ink">
                    {placesLeft} part(s) sur {group.maxMembers} ({activeShareCount} attribuée(s),{' '}
                    {activeMemberCount} personne(s))
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-muted">Parts payées par tour</dt>
                  <dd className="font-semibold text-ink">{group.sharesPerRound ?? 1}</dd>
                </div>
                {(group.membershipFeeAmount ?? 0) > 0 ? (
                  <div className="col-span-2">
                    <dt className="text-muted">Frais d’adhésion (une seule fois)</dt>
                    <dd className="font-semibold text-ink">
                      <AmountText value={group.membershipFeeAmount ?? 0} />
                    </dd>
                  </div>
                ) : null}
                <div className="col-span-2">
                  <dt className="text-muted">Administrateurs</dt>
                  <dd className="font-semibold text-ink">{adminNames.join(', ') || '—'}</dd>
                </div>
              </dl>
            </Card>

            {myMembershipStatus === 'active' ? (
              <Card tone="positive" className="flex items-center gap-3 text-green-700">
                <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
                <p className="flex-1">Vous êtes déjà membre de ce groupe.</p>
                <Link to={`/groupes/${group.id}`} className="font-semibold text-blue-700 underline">
                  Ouvrir
                </Link>
              </Card>
            ) : myMembershipStatus === 'pending' || join.isSuccess ? (
              <Card tone="info" className="flex items-center gap-3 text-blue-700">
                <Clock className="h-6 w-6 shrink-0" aria-hidden="true" />
                <p>Demande envoyée, en attente de l’administrateur.</p>
              </Card>
            ) : group.status !== 'draft' || placesLeft === 0 ? (
              <Card className="text-muted">Ce groupe n’accepte plus de nouveaux membres.</Card>
            ) : (
              <OnlineButton
                block
                loading={join.isPending}
                onClick={() => join.mutate()}
                icon={<UserPlus className="h-5 w-5" aria-hidden="true" />}
              >
                Demander à rejoindre
              </OnlineButton>
            )}
          </div>
        )}
      </AsyncContent>
    </>
  );
}
