import { useState } from 'react';
import { Plus } from 'lucide-react';
import { GroupCard } from '@/components/domain';
import { PageHeader } from '@/components/layout/PageHeader';
import { AsyncContent, Button, EmptyState } from '@/components/ui';
import { JoinGroupDialog } from './JoinGroupDialog';
import { useMyGroups } from './queries';

export default function GroupsPage() {
  const query = useMyGroups();
  const [joinOpen, setJoinOpen] = useState(false);

  return (
    <>
      <PageHeader
        title="Mes groupes"
        actions={
          <Button
            size="sm"
            variant="blue"
            onClick={() => setJoinOpen(true)}
            icon={<Plus className="h-4 w-4" aria-hidden="true" />}
          >
            Rejoindre
          </Button>
        }
      />
      <AsyncContent query={query}>
        {(groups) =>
          groups.length === 0 ? (
            <EmptyState
              title="Vous n’avez pas encore de groupe"
              description="Demandez un code d’invitation à l’administrateur de votre tontine."
              action={
                <Button block variant="blue" onClick={() => setJoinOpen(true)}>
                  Rejoindre un groupe
                </Button>
              }
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {groups.map((overview) => (
                <li key={overview.group.id}>
                  <GroupCard
                    overview={overview}
                    to={
                      overview.myMembershipStatus === 'pending'
                        ? `/rejoindre/${overview.group.inviteCode}`
                        : `/groupes/${overview.group.id}`
                    }
                  />
                </li>
              ))}
            </ul>
          )
        }
      </AsyncContent>
      <JoinGroupDialog open={joinOpen} onClose={() => setJoinOpen(false)} />
    </>
  );
}
