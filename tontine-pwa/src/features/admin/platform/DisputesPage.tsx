import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, CardTitle, Input, Textarea } from '@/components/ui';
import { formatDate, formatDateTime, fullName } from '@/lib/format';
import { useAction } from '@/lib/query';
import { disputeService } from '@/services';
import type { DisputeView } from '@/types';
import { useShowMore } from '../components/useShowMore';
import { PageFrame, QueryState, Stat } from './PlatformUi';
import { disputeKindLabel, disputeStatusLabel, money } from './labels';

export function DisputesPage() {
  const disputes = useQuery({
    queryKey: ['admin', 'disputes'],
    queryFn: () => disputeService.list(),
  });
  const [selected, setSelected] = useState<DisputeView | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [note, setNote] = useState('');
  const take = useAction({
    action: (id: string) => disputeService.take(id),
    success: 'Litige pris en charge',
  });
  const record = useAction({
    action: (id: string) => disputeService.recordPayment(id),
    success: 'Paiement enregistré',
  });
  const refund = useAction({
    action: ({ id, amount, message }: { id: string; amount: number; message: string }) =>
      disputeService.refund(id, amount, message),
    success: 'Remboursement validé',
    onSuccess: () => {
      setSelected(null);
      setNote('');
    },
  });
  const reject = useAction({
    action: ({ id, message }: { id: string; message: string }) =>
      disputeService.reject(id, message),
    success: 'Réclamation rejetée',
    onSuccess: () => {
      setSelected(null);
      setNote('');
    },
  });
  const disputePage = useShowMore(disputes.data ?? [], 15, null);
  return (
    <PageFrame
      title="Litiges et remboursements"
      subtitle="Examinez les réclamations des membres et tracez chaque décision."
    >
      <QueryState query={disputes}>
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(['open', 'in_progress', 'resolved', 'rejected'] as const).map((status) => (
              <Stat
                key={status}
                label={disputeStatusLabel[status]}
                value={
                  (disputes.data ?? []).filter((item) => item.dispute.status === status).length
                }
              />
            ))}
          </div>
          {selected ? (
            <Card className="flex flex-col gap-4 border-2 border-blue-100">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>Traiter la réclamation de {fullName(selected.user)}</CardTitle>
                  <p className="mt-1 text-label text-muted">
                    {selected.groupName} · {disputeKindLabel[selected.dispute.kind]} ·{' '}
                    {money(selected.dispute.amount)}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setSelected(null)}>
                  Fermer
                </Button>
              </div>
              <p>{selected.dispute.description}</p>
              {selected.dispute.providerRef ? (
                <p className="text-label text-muted">
                  Référence prestataire : {selected.dispute.providerRef}
                </p>
              ) : null}
              <ol className="flex flex-col gap-2 border-l-2 border-line pl-4">
                {selected.history.map((event, index) => (
                  <li key={`${event.at}-${index}`}>
                    <strong>{event.actorName}</strong> · {event.text}
                    <span className="block text-small text-muted">{formatDateTime(event.at)}</span>
                  </li>
                ))}
              </ol>
              {selected.dispute.status === 'open' || selected.dispute.status === 'in_progress' ? (
                <div className="grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
                  <Input
                    label="Montant du remboursement (FCFA)"
                    type="number"
                    min="1"
                    max={selected.dispute.amount}
                    value={refundAmount || selected.dispute.amount}
                    onChange={(event) => setRefundAmount(event.target.value)}
                  />
                  <Textarea
                    label="Message / motif (obligatoire pour rejeter)"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                  <div className="flex flex-wrap gap-2 sm:col-span-2">
                    {selected.dispute.status === 'open' ? (
                      <Button
                        variant="blue"
                        loading={take.isPending}
                        onClick={() => take.mutate(selected.dispute.id)}
                      >
                        Prendre en charge
                      </Button>
                    ) : null}
                    {selected.dispute.kind === 'debited_not_recorded' ? (
                      <Button
                        variant="primary"
                        loading={record.isPending}
                        onClick={() => record.mutate(selected.dispute.id)}
                      >
                        Enregistrer le paiement
                      </Button>
                    ) : null}
                    <Button
                      variant="primary"
                      loading={refund.isPending}
                      disabled={!refundAmount || Number(refundAmount) <= 0}
                      onClick={() =>
                        refund.mutate({
                          id: selected.dispute.id,
                          amount: Number(refundAmount),
                          message: note,
                        })
                      }
                    >
                      Valider le remboursement
                    </Button>
                    <Button
                      variant="danger"
                      loading={reject.isPending}
                      disabled={!note.trim()}
                      onClick={() => reject.mutate({ id: selected.dispute.id, message: note })}
                    >
                      Rejeter
                    </Button>
                  </div>
                </div>
              ) : null}
            </Card>
          ) : null}
          <Card className="flex flex-col gap-3">
            <CardTitle>Réclamations reçues</CardTitle>
            {(disputes.data ?? []).length ? (
              disputePage.visible.map((item) => (
                <button
                  key={item.dispute.id}
                  type="button"
                  onClick={() => {
                    setSelected(item);
                    setRefundAmount(String(item.dispute.amount));
                    setNote('');
                  }}
                  className="flex flex-col gap-1 rounded-control border border-line p-4 text-left transition-colors hover:border-blue-700"
                >
                  <span className="flex flex-wrap items-center gap-2 font-bold">
                    {fullName(item.user)} · {disputeKindLabel[item.dispute.kind]}
                    <Badge
                      tone={
                        item.dispute.status === 'resolved'
                          ? 'success'
                          : item.dispute.status === 'rejected'
                            ? 'danger'
                            : item.dispute.status === 'open'
                              ? 'warning'
                              : 'info'
                      }
                    >
                      {disputeStatusLabel[item.dispute.status]}
                    </Badge>
                  </span>
                  <span className="text-label text-muted">
                    {item.groupName} · {money(item.dispute.amount)} ·{' '}
                    {formatDate(item.dispute.createdAt)}
                  </span>
                  <span className="line-clamp-2 text-label">{item.dispute.description}</span>
                </button>
              ))
            ) : (
              <p className="text-muted">Aucune réclamation enregistrée.</p>
            )}
            {disputePage.more}
          </Card>
        </>
      </QueryState>
    </PageFrame>
  );
}
