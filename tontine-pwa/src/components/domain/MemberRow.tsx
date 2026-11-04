import type { ReactNode } from 'react';
import { Avatar, Badge } from '@/components/ui';
import { formatPhone, fullName } from '@/lib/format';
import type { MemberView } from '@/types';
import { StatusBadge } from './StatusBadge';

interface MemberRowProps {
  member: MemberView;
  /** Position dans la liste (alternance des couleurs d'avatar). */
  index?: number;
  isMe?: boolean;
  actions?: ReactNode;
}

/** Ligne de part : un même membre peut apparaître plusieurs fois avec ses parts distinctes. */
export function MemberRow({ member, index, isMe, actions }: MemberRowProps) {
  const { user, membership, currentStatus, shareNumber, shareCount } = member;
  const isAdmin = membership.role === 'owner' || membership.role === 'co_admin';
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <Avatar name={fullName(user)} src={user.avatarUrl} index={index} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-bold text-ink">
          {fullName(user)}
          {isMe ? <span className="font-normal text-muted"> (vous)</span> : null}
        </p>
        <div className="flex flex-wrap items-center gap-x-2 text-small text-muted">
          {shareCount > 1 ? <span>Part {shareNumber} sur {shareCount}</span> : null}
          {membership.payoutOrder ? <span>Tour {membership.payoutOrder}</span> : null}
          {user.phone ? <span className="tabular-nums">{formatPhone(user.phone)}</span> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {isAdmin ? (
          <StatusBadge
            status="admin"
            label={membership.role === 'owner' ? 'Propriétaire' : 'Admin'}
          />
        ) : null}
        {membership.status === 'pending' ? <Badge tone="warning">Demande</Badge> : null}
        {currentStatus ? <StatusBadge status={currentStatus} /> : null}
      </div>
      {actions ? <div className="flex w-full flex-wrap gap-2 sm:w-auto">{actions}</div> : null}
    </li>
  );
}
