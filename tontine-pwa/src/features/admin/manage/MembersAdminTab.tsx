import { useState } from 'react';
import { UserMinus } from 'lucide-react';
import { MemberRow } from '@/components/domain';
import { OnlineButton } from '@/components/layout/OnlineButton';
import { AsyncContent, Card, CardTitle, ConfirmDialog } from '@/components/ui';
import { useMembers } from '@/features/groups/queries';
import { useCurrentUser } from '@/hooks/useAuth';
import { fullName } from '@/lib/format';
import { useAction } from '@/lib/query';
import { membershipService } from '@/services';
import type { GroupOverview, MemberView } from '@/types';
import { AddMemberForm } from './AddMemberForm';
import { GroupAdminsSection } from './GroupAdminsSection';
import { ParticipateButton } from './ParticipateButton';
import { PendingRequests } from './PendingRequests';

export function MembersAdminTab({ overview }: { overview: GroupOverview }) {
  const { group } = overview;
  const user = useCurrentUser();
  const query = useMembers(group.id);
  const [toRemove, setToRemove] = useState<MemberView | null>(null);
  const isOwner = overview.myRole === 'owner' || user.globalRole === 'super_admin';
  const isDraft = group.status === 'draft';
  const denthie = group.kind === 'denthie';

  const remove = useAction({
    action: (membershipId: string) => membershipService.remove(membershipId),
    success: 'Membre retiré',
    onSuccess: () => setToRemove(null),
  });

  return (
    <AsyncContent query={query}>
      {(members) => {
        const active = members.filter((m) => m.membership.status === 'active');
        const pending = members.filter((m) => m.membership.status === 'pending');
        const canRemove = (m: MemberView) =>
          isDraft && m.membership.role !== 'owner' && (m.membership.role !== 'co_admin' || isOwner);
        return (
          <div className="flex flex-col gap-3">
            <PendingRequests
              requests={pending}
              full={active.length >= group.maxMembers}
              denthie={denthie}
            />
            {isDraft &&
            user.globalRole === 'admin' &&
            !active.some((member) => member.user.id === user.id) &&
            active.length < group.maxMembers ? (
              <Card className="flex flex-col gap-3">
                <CardTitle>Participer vous aussi</CardTitle>
                <p className="text-label text-muted">
                  {denthie
                    ? 'Vous gérez ce Denthie sans y cotiser. Vous pouvez y épargner comme les autres membres : vous cotiserez à chaque période et récupérerez votre épargne à la fin.'
                    : 'Vous gérez ce groupe sans y cotiser. Vous pouvez y prendre une part comme les autres membres : vous cotiserez à chaque tour et recevrez la cagnotte à votre tour.'}
                </p>
                <ParticipateButton groupId={group.id} block />
              </Card>
            ) : null}
            {isDraft ? (
              <AddMemberForm
                groupId={group.id}
                maxShares={Math.max(0, group.maxMembers - active.length)}
                denthie={denthie}
              />
            ) : null}
            <Card padded={false} className="px-4">
              <CardTitle className="pt-4">
                {denthie ? 'Membres' : 'Parts attribuées'}{' '}
                <span className="tabular-nums text-muted">
                  ({active.length} / {group.maxMembers})
                </span>
              </CardTitle>
              <p className="text-label text-muted">
                {denthie
                  ? 'Chaque membre verse sa cotisation à chaque période et récupère son épargne à la fin.'
                  : `${new Set(active.map((member) => member.user.id)).size} personne(s) · chaque part verse une cotisation et donne droit à un tour.`}
              </p>
              {!isDraft ? (
                <p className="text-label text-muted">
                  {denthie
                    ? 'Le Denthie a démarré : la liste des membres est close.'
                    : 'Le cycle a démarré : les membres ne peuvent plus être retirés.'}
                </p>
              ) : null}
              <ul className="divide-y divide-line">
                {active.map((member, index) => (
                  <MemberRow
                    key={member.membership.id}
                    member={member}
                    index={index}
                    isMe={member.user.id === user.id}
                    actions={
                      canRemove(member) ? (
                        <OnlineButton
                          size="sm"
                          variant="danger"
                          onClick={() => setToRemove(member)}
                          icon={<UserMinus className="h-4 w-4" aria-hidden="true" />}
                        >
                          {denthie ? 'Retirer' : 'Retirer la part'}
                        </OnlineButton>
                      ) : null
                    }
                  />
                ))}
              </ul>
            </Card>
            <GroupAdminsSection members={active} isOwner={isOwner} />
            <ConfirmDialog
              open={toRemove !== null}
              onClose={() => setToRemove(null)}
              onConfirm={() => toRemove && remove.mutate(toRemove.membership.id)}
              loading={remove.isPending}
              tone="danger"
              title={denthie ? 'Retirer ce membre ?' : 'Retirer cette part ?'}
              confirmLabel={denthie ? 'Retirer' : 'Retirer la part'}
            >
              {toRemove
                ? denthie
                  ? `${fullName(toRemove.user)} sera retiré(e) de « ${group.name} ».`
                  : `La part ${toRemove.shareNumber} de ${fullName(toRemove.user)} sera retirée de « ${group.name} ».`
                : null}
            </ConfirmDialog>
          </div>
        );
      }}
    </AsyncContent>
  );
}
