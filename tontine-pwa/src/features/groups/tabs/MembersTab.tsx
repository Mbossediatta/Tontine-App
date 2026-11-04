import { MemberRow } from '@/components/domain';
import { AsyncContent, Card } from '@/components/ui';
import { useCurrentUser } from '@/hooks/useAuth';
import { useMembers } from '../queries';

/** Membres du groupe (sans numéros de téléphone pour les participants). */
export function MembersTab({ groupId }: { groupId: string }) {
  const user = useCurrentUser();
  const query = useMembers(groupId);
  return (
    <AsyncContent query={query}>
      {(members) => (
        <Card padded={false} className="px-4">
          <ul className="divide-y divide-line">
            {members
              .filter((m) => m.membership.status === 'active')
              .map((member, index) => (
                <MemberRow
                  key={member.membership.id}
                  member={member}
                  index={index}
                  isMe={member.user.id === user.id}
                />
              ))}
          </ul>
        </Card>
      )}
    </AsyncContent>
  );
}
