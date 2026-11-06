import { HandCoins } from 'lucide-react';
import { OnlineButton } from '@/components/layout/OnlineButton';
import { useCurrentUser } from '@/hooks/useAuth';
import { useAction } from '@/lib/query';
import { membershipService } from '@/services';

/** « Je participe à ce groupe » : une part au numéro de l'admin connecté. */
export function ParticipateButton({
  groupId,
  block = false,
}: {
  groupId: string;
  block?: boolean;
}) {
  const user = useCurrentUser();
  const join = useAction({
    action: () => membershipService.addByPhone(groupId, user.phone, 1),
    success: 'Vous participez à ce groupe',
  });
  return (
    <OnlineButton
      block={block}
      size={block ? undefined : 'sm'}
      loading={join.isPending}
      onClick={() => join.mutate()}
      icon={<HandCoins className="h-4 w-4" aria-hidden="true" />}
    >
      Je participe
    </OnlineButton>
  );
}
