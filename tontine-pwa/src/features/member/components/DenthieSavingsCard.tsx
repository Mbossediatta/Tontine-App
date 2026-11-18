// Espace membre d'un Denthie : mon épargne, la date de répartition, mon carnet et la
// demande de retrait d'urgence (l'admin décide).
import { useState } from 'react';
import { BookOpen, PiggyBank } from 'lucide-react';
import { Link } from 'react-router-dom';
import { bookUnlocked } from '@/lib/denthie';
import { formatDate } from '@/lib/format';
import { useAction } from '@/lib/query';
import { groupService } from '@/services';
import type { GroupOverview } from '@/types';
import { AmountDisplay } from '../ui/AmountDisplay';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

function WithdrawalSheet({
  overview,
  open,
  onClose,
}: {
  overview: GroupOverview;
  open: boolean;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const send = useAction({
    action: () => groupService.requestWithdrawal(overview.group.id, reason),
    success: 'Demande envoyée : l’administrateur va vous répondre',
    onSuccess: () => {
      setReason('');
      onClose();
    },
  });
  return (
    <BottomSheet open={open} onClose={onClose} title="Retrait d’urgence">
      <div className="flex flex-col gap-4">
        <p className="text-[15px] text-slate-700">
          En cas d’urgence seulement : si l’administrateur accepte, vous recevez votre épargne (
          <AmountDisplay value={overview.mySaved ?? 0} />, moins vos pénalités non réglées) et vous
          ne cotisez plus dans ce Denthie.
        </p>
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-slate-900">
          Raison de l’urgence
          <textarea
            value={reason}
            maxLength={300}
            rows={3}
            onChange={(event) => setReason(event.target.value)}
            className="rounded-lg border border-slate-300 p-3 text-[15px] font-normal focus:border-blue-700 focus:outline-none"
          />
        </label>
        <Button
          block
          disabled={reason.trim().length < 4}
          loading={send.isPending}
          onClick={() => send.mutate()}
        >
          Envoyer la demande
        </Button>
      </div>
    </BottomSheet>
  );
}

export function DenthieSavingsCard({ overview }: { overview: GroupOverview }) {
  const { group, savings } = overview;
  const [asking, setAsking] = useState(false);
  const running = group.status === 'active' && !savings?.distribution;
  return (
    <Card className="flex flex-col gap-3 p-4">
      <p className="flex items-center gap-2 text-[13px] font-semibold text-slate-600">
        <PiggyBank className="h-4 w-4 text-blue-700" aria-hidden="true" />
        Mon épargne
      </p>
      <AmountDisplay value={overview.mySaved ?? 0} size="xl" className="text-green-700" />
      <p className="text-[13px] text-slate-600">
        {savings?.currentPeriod ? `Période ${savings.currentPeriod} en cours. ` : ''}
        {group.status === 'finished'
          ? 'La répartition est faite : chacun reçoit ce qu’il a versé.'
          : group.endDate
            ? `Répartition prévue le ${formatDate(group.endDate)} : vous recevrez ce que vous avez versé.`
            : 'La date de répartition sera fixée par l’administrateur ; vous serez prévenu.'}
      </p>
      {bookUnlocked(overview) ? (
        <Link
          to={`/groupes/${group.id}/carnet`}
          className="flex min-h-[48px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-[15px] font-semibold text-slate-900 hover:border-blue-700 hover:text-blue-700"
        >
          <BookOpen className="h-5 w-5" aria-hidden="true" />
          Mon carnet
        </Link>
      ) : (
        <p className="rounded-lg bg-blue-50 px-3 py-2 text-[13px] text-blue-800">
          Votre carnet électronique s’ouvre après le paiement des frais d’adhésion (
          <AmountDisplay value={overview.myMembershipFeeDue} />, avec votre première cotisation).
        </p>
      )}
      {running ? (
        <Button variant="quiet" onClick={() => setAsking(true)}>
          Demander un retrait d’urgence
        </Button>
      ) : null}
      <WithdrawalSheet overview={overview} open={asking} onClose={() => setAsking(false)} />
    </Card>
  );
}
