import { Check, X } from 'lucide-react';
import { OnlineButton } from '@/components/layout/OnlineButton';
import { Avatar, Card, CardTitle } from '@/components/ui';
import { formatPhone, fullName } from '@/lib/format';
import { useAction } from '@/lib/query';
import { membershipService } from '@/services';
import type { MemberView } from '@/types';

interface PendingRequestsProps {
  requests: MemberView[];
  full: boolean;
}

/** Demandes d'adhésion en attente : Accepter / Refuser. */
export function PendingRequests({ requests, full }: PendingRequestsProps) {
  const accept = useAction({
    action: (id: string) => membershipService.accept(id),
    success: 'Demande acceptée',
  });
  const reject = useAction({
    action: (id: string) => membershipService.reject(id),
    success: 'Demande refusée',
  });

  if (requests.length === 0) return null;
  return (
    <Card className="flex flex-col gap-2">
      <CardTitle>Demandes en attente ({requests.length})</CardTitle>
      {full ? (
        <p className="text-label text-muted">
          Toutes les parts sont attribuées : retirez une part pour accepter.
        </p>
      ) : null}
      <ul className="divide-y divide-line">
        {requests.map(({ membership, user }) => (
          <li key={membership.id} className="flex flex-wrap items-center gap-3 py-3">
            <Avatar name={fullName(user)} src={user.avatarUrl} />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-ink">{fullName(user)}</p>
              {user.phone ? (
                <p className="text-label tabular-nums text-muted">{formatPhone(user.phone)}</p>
              ) : null}
            </div>
            <div className="flex gap-2">
              <OnlineButton
                size="sm"
                variant="danger"
                loading={reject.isPending && reject.variables === membership.id}
                onClick={() => reject.mutate(membership.id)}
                icon={<X className="h-4 w-4" aria-hidden="true" />}
              >
                Refuser
              </OnlineButton>
              <OnlineButton
                size="sm"
                disabled={full}
                loading={accept.isPending && accept.variables === membership.id}
                onClick={() => accept.mutate(membership.id)}
                icon={<Check className="h-4 w-4" aria-hidden="true" />}
              >
                Accepter
              </OnlineButton>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
