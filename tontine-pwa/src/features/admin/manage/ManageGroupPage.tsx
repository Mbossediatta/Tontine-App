import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { GroupStatusBadge } from '@/components/domain';
import { AsyncContent, GroupPhoto, Tabs, type TabItem } from '@/components/ui';
import { useGroup } from '@/features/groups/queries';
import { useAuth } from '@/hooks/useAuth';
import { groupContributionLabel } from '@/lib/format';
import { SupervisionCard } from '../groups/SupervisionCard';
import { MembersAdminTab } from './MembersAdminTab';
import { OverviewTab } from './OverviewTab';
import { PaymentsTab } from './PaymentsTab';
import { RoundsTab } from './RoundsTab';
import { SettingsTab } from './SettingsTab';

type TabId = 'apercu' | 'membres' | 'paiements' | 'tours' | 'reglages';

const TABS: ReadonlyArray<TabItem<TabId>> = [
  { id: 'apercu', label: 'Aperçu' },
  { id: 'membres', label: 'Membres' },
  { id: 'paiements', label: 'Paiements' },
  { id: 'tours', label: 'Tours' },
  { id: 'reglages', label: 'Réglages' },
];

export default function ManageGroupPage() {
  const { id = '' } = useParams();
  const query = useGroup(id);
  // ?onglet=membres ouvre directement un onglet (liens du tableau de bord).
  const [params] = useSearchParams();
  const requested = TABS.find((t) => t.id === params.get('onglet'))?.id;
  const [tab, setTab] = useState<TabId>(requested ?? 'apercu');
  const { isSuperAdmin } = useAuth();

  return (
    <AsyncContent query={query} errorMessage="Impossible d’ouvrir ce groupe.">
      {(overview) => (
        <div className="flex flex-col gap-3">
          {overview.group.photoUrl ? (
            <GroupPhoto
              name={overview.group.name}
              src={overview.group.photoUrl}
              size="lg"
              className="self-start"
            />
          ) : null}
          <PageHeader
            plain
            title={overview.group.name}
            // Le super administrateur revient à la liste de tous les groupes.
            backTo={isSuperAdmin ? '/admin/groupes' : '/admin'}
            subtitle={
              <span className="flex flex-wrap items-center gap-2">
                {groupContributionLabel(overview.group)}
                <GroupStatusBadge status={overview.group.status} />
              </span>
            }
          />
          {isSuperAdmin ? <SupervisionCard overview={overview} /> : null}
          <Tabs items={TABS} value={tab} onChange={setTab} label="Gestion du groupe" />
          <div role="tabpanel">
            {tab === 'apercu' ? <OverviewTab overview={overview} onGoTo={setTab} /> : null}
            {tab === 'membres' ? <MembersAdminTab overview={overview} /> : null}
            {tab === 'paiements' ? <PaymentsTab overview={overview} /> : null}
            {tab === 'tours' ? <RoundsTab overview={overview} /> : null}
            {tab === 'reglages' ? <SettingsTab overview={overview} /> : null}
          </div>
        </div>
      )}
    </AsyncContent>
  );
}
