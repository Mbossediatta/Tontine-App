import { useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { OnlineButton } from '@/components/layout/OnlineButton';
import { Badge, type BadgeTone, Card, CardTitle, ConfirmDialog } from '@/components/ui';
import { formatDate, fullName } from '@/lib/format';
import { useAction } from '@/lib/query';
import { swapService } from '@/services';
import type { SwapStatus, SwapView } from '@/types';

const STATUS: Record<SwapStatus, { label: string; tone: BadgeTone }> = {
  pending_partner: { label: 'En attente du membre', tone: 'warning' },
  pending_admin: { label: 'À valider par l’admin', tone: 'info' },
  approved: { label: 'Validé', tone: 'success' },
  rejected: { label: 'Refusé', tone: 'neutral' },
  cancelled: { label: 'Annulé', tone: 'neutral' },
};

interface SwapListProps {
  swaps: SwapView[];
  myUserId: string;
  /** member : accepter / refuser / annuler · admin : valider / refuser. */
  mode: 'member' | 'admin';
}

/** Demandes d'échange de tour du cycle en cours. */
export function SwapList({ swaps, myUserId, mode }: SwapListProps) {
  const [toApprove, setToApprove] = useState<SwapView | null>(null);
  const respond = useAction({
    action: ({ id, accept }: { id: string; accept: boolean }) => swapService.respond(id, accept),
    success: 'Réponse envoyée',
  });
  const decide = useAction({
    action: ({ id, approve }: { id: string; approve: boolean }) => swapService.decide(id, approve),
    success: 'Décision enregistrée',
    onSuccess: () => setToApprove(null),
  });
  const cancel = useAction({
    action: (id: string) => swapService.cancel(id),
    success: 'Demande annulée',
  });

  const visible =
    mode === 'admin' ? swaps.filter((s) => s.request.status === 'pending_admin') : swaps;
  if (visible.length === 0) return null;

  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>{mode === 'admin' ? 'Échanges de tour à valider' : 'Échanges de tour'}</CardTitle>
      <ul className="flex flex-col divide-y divide-line">
        {visible.map((swap) => {
          const { request, requester, partner, requesterRound, partnerRound } = swap;
          const busy = respond.isPending || decide.isPending || cancel.isPending;
          return (
            <li key={request.id} className="flex flex-col gap-2 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <ArrowLeftRight className="h-4 w-4 text-blue-700" aria-hidden="true" />
                <span className="flex-1 font-bold text-ink">
                  {request.requesterId === myUserId ? 'Vous' : fullName(requester)} ↔{' '}
                  {request.partnerId === myUserId
                    ? 'vous'
                    : mode === 'member'
                      ? `le membre du tour ${partnerRound.number}`
                      : fullName(partner)}
                </span>
                <Badge tone={STATUS[request.status].tone}>{STATUS[request.status].label}</Badge>
              </div>
              <p className="text-label text-muted">
                Tour {requesterRound.number} ({formatDate(requesterRound.dueDate)}) contre tour{' '}
                {partnerRound.number} ({formatDate(partnerRound.dueDate)})
              </p>
              <div className="flex flex-wrap gap-2">
                {mode === 'member' &&
                request.status === 'pending_partner' &&
                request.partnerId === myUserId ? (
                  <>
                    <OnlineButton
                      size="sm"
                      disabled={busy}
                      onClick={() => respond.mutate({ id: request.id, accept: true })}
                    >
                      Accepter
                    </OnlineButton>
                    <OnlineButton
                      size="sm"
                      variant="danger"
                      disabled={busy}
                      onClick={() => respond.mutate({ id: request.id, accept: false })}
                    >
                      Refuser
                    </OnlineButton>
                  </>
                ) : null}
                {mode === 'member' &&
                request.requesterId === myUserId &&
                (request.status === 'pending_partner' || request.status === 'pending_admin') ? (
                  <OnlineButton
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => cancel.mutate(request.id)}
                  >
                    Annuler ma demande
                  </OnlineButton>
                ) : null}
                {mode === 'admin' ? (
                  <>
                    <OnlineButton size="sm" disabled={busy} onClick={() => setToApprove(swap)}>
                      Valider
                    </OnlineButton>
                    <OnlineButton
                      size="sm"
                      variant="danger"
                      disabled={busy}
                      onClick={() => decide.mutate({ id: request.id, approve: false })}
                    >
                      Refuser
                    </OnlineButton>
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={toApprove !== null}
        onClose={() => setToApprove(null)}
        onConfirm={() => toApprove && decide.mutate({ id: toApprove.request.id, approve: true })}
        loading={decide.isPending}
        tone="blue"
        title="Valider l’échange ?"
        confirmLabel="Valider l’échange"
      >
        {toApprove ? (
          <p>
            {fullName(toApprove.requester)} recevra la cagnotte au tour{' '}
            {toApprove.partnerRound.number} et {fullName(toApprove.partner)} au tour{' '}
            {toApprove.requesterRound.number}. Les deux membres ont donné leur accord.
          </p>
        ) : null}
      </ConfirmDialog>
    </Card>
  );
}
