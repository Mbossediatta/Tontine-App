import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { disputeKindLabel, disputeStatusLabel } from '@/features/admin/platform/labels';
import { useMyGroups, useRounds } from '@/features/groups/queries';
import { useCurrentUser } from '@/hooks/useAuth';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import { queryKeys, useAction } from '@/lib/query';
import { disputeService } from '@/services';
import type { DisputeKind, OpenDisputeInput } from '@/types';
import { AmountDisplay } from '../ui/AmountDisplay';
import { Button } from '../ui/Button';
import { Card, PageTitle, SectionHeader } from '../ui/Card';
import { EmptyState, ErrorBlock } from '../ui/EmptyState';
import { ListSkeleton } from '../ui/Skeleton';

/** Motifs proposés au membre, dans l'ordre où il les rencontre le plus. */
const KINDS: Array<{ id: DisputeKind; label: string; detail: string }> = [
  {
    id: 'debited_not_recorded',
    label: 'Paiement débité, non enregistré',
    detail: 'L’argent est parti de mon compte, mais l’appli ne voit pas mon paiement.',
  },
  {
    id: 'payout_not_received',
    label: 'Cagnotte non reçue',
    detail: 'Ma cagnotte est marquée envoyée, mais je n’ai rien reçu.',
  },
  { id: 'double_payment', label: 'Payé deux fois', detail: 'J’ai été débité deux fois.' },
  { id: 'wrong_amount', label: 'Mauvais montant', detail: 'Le montant débité n’est pas le bon.' },
  { id: 'other', label: 'Autre problème', detail: 'Expliquez ce qui ne va pas.' },
];

const FIELD =
  'min-h-[48px] w-full rounded-lg border border-slate-300 bg-white px-3 text-[15px] focus:border-blue-700 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-blue-700';

const STATUS_TONE = {
  open: 'bg-amber-100 text-amber-800',
  in_progress: 'bg-blue-100 text-blue-800',
  resolved: 'bg-green-100 text-green-800',
  rejected: 'bg-slate-200 text-slate-700',
} as const;

/** Formulaire de réclamation, prérempli depuis « Je n'ai rien reçu » ou un paiement. */
function ClaimForm() {
  const user = useCurrentUser();
  const [params] = useSearchParams();
  const groups = (useMyGroups().data ?? []).filter((g) => g.myMembershipStatus === 'active');
  const [groupId, setGroupId] = useState(params.get('groupe') ?? '');
  const selectedGroup = groupId || groups[0]?.group.id || '';
  const rounds = useRounds(selectedGroup);
  const [roundId, setRoundId] = useState(params.get('tour') ?? '');
  const [kind, setKind] = useState<DisputeKind>(
    params.get('motif') === 'payout' ? 'payout_not_received' : 'debited_not_recorded',
  );
  const [method, setMethod] = useState<'wave' | 'orange_money'>('wave');
  const [ref, setRef] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');

  // Cagnotte non reçue : le montant est celui de ma cagnotte pour ce tour.
  const round = (rounds.data ?? []).find((view) => view.round.id === roundId);
  const suggested =
    kind === 'payout_not_received' ? round?.round.beneficiaryAmounts?.[user.id] : undefined;
  const value = amount === '' && suggested !== undefined ? String(suggested) : amount;

  const submit = useAction({
    action: (input: OpenDisputeInput) => disputeService.open(input),
    success: 'Réclamation envoyée : vous serez prévenu de son traitement',
    onSuccess: () => {
      setDescription('');
      setRef('');
      setAmount('');
    },
  });
  const valid = selectedGroup !== '' && description.trim().length >= 5 && Number(value) >= 0;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        submit.mutate({
          groupId: selectedGroup,
          roundId: roundId || undefined,
          kind,
          amount: Number(value) || 0,
          method: kind === 'other' ? undefined : method,
          providerRef: ref.trim() || undefined,
          description: description.trim(),
        });
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[15px] font-semibold">Quel est le problème ?</legend>
        {KINDS.map((item) => (
          <label
            key={item.id}
            className={cn(
              'flex cursor-pointer flex-col rounded-xl border bg-white px-4 py-3 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-blue-700',
              kind === item.id ? 'border-blue-700 bg-blue-50' : 'border-slate-200',
            )}
          >
            <input
              type="radio"
              name="kind"
              className="sr-only"
              checked={kind === item.id}
              onChange={() => setKind(item.id)}
            />
            <span className="text-[15px] font-semibold">{item.label}</span>
            <span className="text-[13px] text-slate-600">{item.detail}</span>
          </label>
        ))}
      </fieldset>

      <label className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold text-slate-700">Groupe</span>
        <select
          className={FIELD}
          value={selectedGroup}
          onChange={(event) => {
            setGroupId(event.target.value);
            setRoundId('');
          }}
        >
          {groups.map(({ group }) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold text-slate-700">Tour concerné</span>
        <select
          className={FIELD}
          value={roundId}
          onChange={(event) => setRoundId(event.target.value)}
        >
          <option value="">Je ne sais pas</option>
          {(rounds.data ?? []).map((view) => (
            <option key={view.round.id} value={view.round.id}>
              Tour {view.round.number} · {formatDate(view.round.dueDate)}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold text-slate-700">Montant (FCFA)</span>
          <input
            className={FIELD}
            type="number"
            inputMode="numeric"
            min={0}
            value={value}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        {kind !== 'other' ? (
          <label className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold text-slate-700">Moyen</span>
            <select
              className={FIELD}
              value={method}
              onChange={(event) => setMethod(event.target.value as 'wave' | 'orange_money')}
            >
              <option value="wave">Wave</option>
              <option value="orange_money">Orange Money</option>
            </select>
          </label>
        ) : null}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold text-slate-700">
          Référence de la transaction (facultatif)
        </span>
        <input
          className={FIELD}
          value={ref}
          maxLength={60}
          onChange={(event) => setRef(event.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold text-slate-700">Explication</span>
        <textarea
          className={cn(FIELD, 'min-h-[96px] py-2')}
          value={description}
          maxLength={1000}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Ex. : j’ai payé 5 000 FCFA par Wave le 5 novembre, mais l’appli indique que je dois encore payer."
        />
      </label>

      <Button type="submit" block loading={submit.isPending} disabled={!valid}>
        Envoyer la réclamation
      </Button>
    </form>
  );
}

/** Réclamations du membre : en ouvrir une, et suivre celles en cours. */
export default function ClaimsPage() {
  const mine = useQuery({
    queryKey: queryKeys.myDisputes,
    queryFn: () => disputeService.listMine(),
  });

  return (
    <div className="flex flex-col gap-6 motion-safe:animate-fade-in">
      <PageTitle>Réclamation</PageTitle>
      <p className="-mt-4 text-[13px] text-slate-600">
        Un paiement absent, une cagnotte non reçue ? L’équipe de la plateforme examine chaque
        réclamation et vous répond ici.
      </p>
      <ClaimForm />

      <section aria-labelledby="my-claims" className="flex flex-col gap-2">
        <SectionHeader id="my-claims" title="Mes réclamations" />
        {mine.isPending ? (
          <ListSkeleton rows={2} />
        ) : mine.isError ? (
          <ErrorBlock onRetry={() => void mine.refetch()} />
        ) : mine.data.length === 0 ? (
          <EmptyState title="Aucune réclamation" description="Vos réclamations apparaîtront ici." />
        ) : (
          <Card>
            <ul className="divide-y divide-slate-200">
              {mine.data.map(({ dispute, groupName, roundNumber, history }) => (
                <li key={dispute.id} className="flex flex-col gap-1 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[15px] font-semibold">
                      {disputeKindLabel[dispute.kind]}
                    </span>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[12px] font-semibold',
                        STATUS_TONE[dispute.status],
                      )}
                    >
                      {disputeStatusLabel[dispute.status]}
                    </span>
                  </div>
                  <span className="text-[13px] text-slate-600">
                    {groupName}
                    {roundNumber ? ` · tour ${roundNumber}` : ''} · {formatDate(dispute.createdAt)}
                    {dispute.amount > 0 ? (
                      <>
                        {' '}
                        · <AmountDisplay value={dispute.amount} />
                      </>
                    ) : null}
                  </span>
                  {history.length > 1 ? (
                    <span className="text-[13px] text-slate-800">
                      Dernière réponse : {history[history.length - 1]?.text}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}
