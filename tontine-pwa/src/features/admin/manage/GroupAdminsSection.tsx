import { useState } from 'react';
import { ShieldMinus, ShieldPlus } from 'lucide-react';
import { OnlineButton } from '@/components/layout/OnlineButton';
import { Avatar, Badge, Card, CardTitle, ConfirmDialog, Select } from '@/components/ui';
import { fullName } from '@/lib/format';
import { useAction } from '@/lib/query';
import { membershipService } from '@/services';
import type { MemberView } from '@/types';

interface GroupAdminsSectionProps {
  members: MemberView[];
  /** Seul le propriétaire peut retirer un co-admin. */
  isOwner: boolean;
}

/** Section « Administrateurs du groupe » : ajout et retrait de co-admins. */
export function GroupAdminsSection({ members, isOwner }: GroupAdminsSectionProps) {
  const [candidate, setCandidate] = useState('');
  const [toDemote, setToDemote] = useState<MemberView | null>(null);
  const admins = members.filter((m) => m.membership.role !== 'member');
  const candidates = members.filter((m) => m.membership.role === 'member');

  const promote = useAction({
    action: (id: string) => membershipService.setRole(id, 'co_admin'),
    success: 'Co-admin ajouté',
    onSuccess: () => setCandidate(''),
  });
  const demote = useAction({
    action: (id: string) => membershipService.setRole(id, 'member'),
    success: 'Co-admin retiré',
    onSuccess: () => setToDemote(null),
  });

  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>Administrateurs du groupe</CardTitle>
      <ul className="flex flex-col gap-2">
        {admins.map((member) => (
          <li key={member.membership.id} className="flex flex-wrap items-center gap-3">
            <Avatar name={fullName(member.user)} src={member.user.avatarUrl} size="sm" />
            <span className="flex-1 font-medium text-ink">{fullName(member.user)}</span>
            <Badge tone="info">
              {member.membership.role === 'owner' ? 'Propriétaire' : 'Co-admin'}
            </Badge>
            {member.membership.role === 'co_admin' && isOwner ? (
              <OnlineButton
                size="sm"
                variant="danger"
                onClick={() => setToDemote(member)}
                icon={<ShieldMinus className="h-4 w-4" aria-hidden="true" />}
              >
                Retirer
              </OnlineButton>
            ) : null}
          </li>
        ))}
      </ul>
      {candidates.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-line pt-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Select
              label="Nommer un co-admin parmi les membres"
              placeholder="Choisir un membre"
              value={candidate}
              onChange={(event) => setCandidate(event.target.value)}
              options={candidates.map((m) => ({ value: m.membership.id, label: fullName(m.user) }))}
            />
          </div>
          <OnlineButton
            disabled={!candidate}
            loading={promote.isPending}
            onClick={() => promote.mutate(candidate)}
            icon={<ShieldPlus className="h-5 w-5" aria-hidden="true" />}
          >
            Ajouter
          </OnlineButton>
        </div>
      ) : null}
      <ConfirmDialog
        open={toDemote !== null}
        onClose={() => setToDemote(null)}
        onConfirm={() => toDemote && demote.mutate(toDemote.membership.id)}
        loading={demote.isPending}
        tone="danger"
        title="Retirer ce co-admin ?"
        confirmLabel="Retirer le rôle"
      >
        {toDemote
          ? `${fullName(toDemote.user)} restera membre mais ne pourra plus gérer le groupe.`
          : null}
      </ConfirmDialog>
    </Card>
  );
}
