import { useState } from 'react';
import { Settings } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { AmountText } from '@/components/domain';
import { PageHeader } from '@/components/layout/PageHeader';
import { AsyncContent, Tabs, type TabItem } from '@/components/ui';
import { groupContributionLabel } from '@/lib/format';
import { formatCycleDuration, formatPeriods } from '@/lib/tontine';
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
        return (
          <div className="flex flex-col gap-3">
            <PageHeader
              title={group.name}
              backTo="/groupes"
              subtitle={`${overview.communityName ? `${overview.communityName} · ` : ''}${groupContributionLabel(group)} · tour de ${formatPeriods(group.frequency, group.turnLength)}`}
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
                {overview.currentRound?.recipientType === 'platform' && !overview.canManage ? (
                  'Période de collecte en cours'
                ) : (
                  <>
                    Cagnotte : <AmountText value={potAmount} className="font-bold" />
                  </>
                )}
                {' · '}
                {`${totalRounds} tours, soit ${formatCycleDuration(group.frequency, totalRounds, group.turnLength)}`}
              </p>
            </PageHeader>
            <Tabs items={TABS} value={tab} onChange={setTab} label="Sections du groupe" />
            <div role="tabpanel" className="animate-fade-in" key={tab}>
              {tab === 'tour' ? <CurrentRoundTab overview={overview} /> : null}
              {tab === 'calendrier' ? <CalendarTab groupId={group.id} /> : null}
              {tab === 'membres' ? <MembersTab groupId={group.id} /> : null}
              {tab === 'historique' ? <HistoryTab groupId={group.id} /> : null}
            </div>
          </div>
        );
      }}
    </AsyncContent>
  );
}
