import { useState } from 'react';
import { Settings } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { AmountText } from '@/components/domain';
import { PageHeader } from '@/components/layout/PageHeader';
import { AsyncContent, Tabs, type TabItem } from '@/components/ui';
import { groupContributionLabel } from '@/lib/format';
import { formatCycleDuration, formatPeriods, payoutPerShare } from '@/lib/tontine';
import { DenthieSavingsCard } from '@/features/member/components/DenthieSavingsCard';
import { isDenthie } from '@/lib/denthie';
import { useGroup } from './queries';
import { CalendarTab } from './tabs/CalendarTab';
import { CurrentRoundTab } from './tabs/CurrentRoundTab';
import { HistoryTab } from './tabs/HistoryTab';
import { MembersTab } from './tabs/MembersTab';

type TabId = 'tour' | 'calendrier' | 'membres' | 'historique';

const TABS: ReadonlyArray<TabItem<TabId>> = [
  { id: 'tour', label: 'Tour' },
  { id: 'calendrier', label: 'Calendrier' },
  { id: 'membres', label: 'Membres' },
  { id: 'historique', label: 'Historique' },
];

export default function GroupDetailPage() {
  const { id = '' } = useParams();
  const query = useGroup(id);
  const [tab, setTab] = useState<TabId>('tour');

  return (
    <AsyncContent query={query} errorMessage="Impossible d’ouvrir ce groupe.">
      {(overview) => {
        const { group, myRole, potAmount, totalRounds } = overview;
        const isManager = myRole === 'owner' || myRole === 'co_admin';
        const denthie = isDenthie(group);
        // Denthie : pas de calendrier de passage ; le premier onglet montre l'épargne.
        const tabs = denthie
          ? TABS.filter((t) => t.id !== 'calendrier').map((t) =>
              t.id === 'tour' ? { ...t, label: 'Épargne' } : t,
            )
          : TABS;
        return (
          <div className="flex flex-col gap-3">
            <PageHeader
              title={group.name}
              backTo="/groupes"
              subtitle={`${overview.communityName ? `${overview.communityName} · ` : ''}${groupContributionLabel(group)} · ${denthie ? 'Denthie' : `tour de ${formatPeriods(group.frequency, group.turnLength)}`}`}
              actions={
                isManager ? (
                  <Link
                    to={`/admin/groupes/${group.id}`}
                    className="inline-flex min-h-touch items-center gap-1 rounded-control bg-white/15 px-3 text-label font-bold text-white hover:bg-white/25"
                  >
                    <Settings className="h-4 w-4" aria-hidden="true" />
                    Gérer
                  </Link>
                ) : null
              }
            >
              <p className="text-body text-white">
                {denthie ? (
                  <>
                    Mon épargne : <AmountText value={overview.mySaved ?? 0} className="font-bold" />
                  </>
                ) : overview.currentRound?.recipientType === 'platform' && !overview.canManage ? (
                  'Période de collecte en cours'
                ) : (
                  <>
                    Cagnotte : <AmountText value={potAmount} className="font-bold" />
                    {(group.sharesPerRound ?? 1) > 1 ? (
                      <>
                        {' '}
                        ({group.sharesPerRound} parts de{' '}
                        <AmountText
                          value={payoutPerShare(potAmount, group.sharesPerRound)}
                          className="font-bold"
                        />
                        )
                      </>
                    ) : null}
                  </>
                )}
                {denthie ? null : (
                  <>
                    {' · '}
                    {`${totalRounds} tours, soit ${formatCycleDuration(group.frequency, totalRounds, group.turnLength)}`}
                  </>
                )}
              </p>
            </PageHeader>
            <Tabs items={tabs} value={tab} onChange={setTab} label="Sections du groupe" />
            <div role="tabpanel" className="animate-fade-in" key={tab}>
              {tab === 'tour' ? (
                <div className="flex flex-col gap-3">
                  {denthie && group.status !== 'draft' ? (
                    <DenthieSavingsCard overview={overview} />
                  ) : null}
                  <CurrentRoundTab overview={overview} />
                </div>
              ) : null}
              {tab === 'calendrier' ? (
                <CalendarTab groupId={group.id} cycleActive={group.status === 'active'} />
              ) : null}
              {tab === 'membres' ? <MembersTab groupId={group.id} /> : null}
              {tab === 'historique' ? <HistoryTab groupId={group.id} /> : null}
            </div>
          </div>
        );
      }}
    </AsyncContent>
  );
}
