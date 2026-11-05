import { useState } from 'react';
import { ChevronLeft, ShieldCheck } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMyGroups } from '@/features/groups/queries';
import { useOnline } from '@/hooks/useOnline';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import { paymentService } from '@/services';
import type { InitiatePaymentInput } from '@/types';
import { deadlineLabel, duesOf, periodLabel, shortDate, type Due } from '../dues';
import { AmountDisplay } from '../ui/AmountDisplay';
import { BottomAction } from '../ui/BottomAction';
import { Button } from '../ui/Button';
import { Card, PageTitle } from '../ui/Card';
import { EmptyState, ErrorBlock } from '../ui/EmptyState';
import { ListSkeleton } from '../ui/Skeleton';
import { markPaymentRedirect } from '@/lib/paymentRedirect';

type Method = InitiatePaymentInput['method'];
type Step = 1 | 2 | 3;

/** Moyens proposés : noms en texte (pas de logos tant que les autorisations ne sont pas obtenues). */
const METHODS: Array<{ id: Method; name: string; detail: string }> = [
  { id: 'wave', name: 'Wave', detail: 'Tu valides dans l’application Wave' },
  { id: 'orange_money', name: 'Orange Money', detail: 'Tu valides avec ton code Orange Money' },
];

const STEP_TITLES: Record<Step, string> = {
  1: 'Quelle cotisation ?',
  2: 'Payer avec',
  3: 'Vérifie et confirme',
};

/** Indicateur discret « Étape 2 sur 3 » avec trois traits. */
function StepIndicator({ step }: { step: Step }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-1 gap-1" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className={cn('h-1 flex-1 rounded-full', n <= step ? 'bg-blue-700' : 'bg-slate-200')}
          />
        ))}
      </div>
      <span className="text-[13px] text-slate-600">Étape {step} sur 3</span>
    </div>
  );
}

/** Ligne choisissable (bouton radio stylé) : cotisation ou moyen de paiement. */
function ChoiceRow({
  name,
  checked,
  onChange,
  children,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  children: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        'flex min-h-[64px] cursor-pointer items-center gap-3 rounded-xl border bg-white px-4 py-3 transition-colors duration-150 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-blue-700',
        checked ? 'border-blue-700 bg-blue-50' : 'border-slate-200 hover:border-slate-300',
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="sr-only" />
      {/* Cercle radio dessiné : plein quand la ligne est choisie. */}
      <span
        aria-hidden="true"
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
          checked ? 'border-blue-700' : 'border-slate-400',
        )}
      >
        {checked ? <span className="h-2.5 w-2.5 rounded-full bg-blue-700" /> : null}
      </span>
      {children}
    </label>
  );
}

/** Récapitulatif avant paiement, en tableau compact. */
/** Montant débité : la cotisation (et ses compléments) plus les frais de paiement. */
const totalToPay = (due: Due) => due.amount + due.overview.myServiceFee;

function Summary({ due, method }: { due: Due; method: Method }) {
  const { overview } = due;
  const contribution = overview.myAmountDue - overview.myPenalty - overview.myMembershipFeeDue;
  const rows: Array<[string, React.ReactNode]> = [
    ['Groupe', overview.group.name],
    ['Période', periodLabel(overview, due.round)],
    ['Cotisation', <AmountDisplay key="c" value={contribution} />],
  ];
  if (overview.myPenalty > 0) {
    rows.push(['Pénalité de retard', <AmountDisplay key="p" value={overview.myPenalty} />]);
  }
  if (overview.myMembershipFeeDue > 0) {
    rows.push(['Frais d’adhésion', <AmountDisplay key="f" value={overview.myMembershipFeeDue} />]);
  }
  if (overview.myServiceFee > 0) {
    // Frais du service de paiement (PayTech) : payés par le membre, hors cagnotte.
    rows.push(['Frais de paiement', <AmountDisplay key="s" value={overview.myServiceFee} />]);
  }
  rows.push(['Moyen', METHODS.find((m) => m.id === method)?.name ?? '']);
  return (
    <Card>
      <dl className="divide-y divide-slate-200">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex min-h-[48px] items-center justify-between gap-4 px-4 py-2"
          >
            <dt className="text-[13px] text-slate-600">{label}</dt>
            <dd className="text-right text-[15px] font-semibold">{value}</dd>
          </div>
        ))}
        <div className="flex min-h-[56px] items-center justify-between gap-4 px-4 py-2">
          <dt className="text-[15px] font-semibold">Total</dt>
          <dd>
            <AmountDisplay value={totalToPay(due)} size="md" />
          </dd>
        </div>
      </dl>
    </Card>
  );
}

/**
 * Payer, en 3 étapes au plus : la cotisation → le moyen (Wave, Orange Money) → la
 * confirmation. Une étape déjà tranchée est sautée (une seule cotisation due, ou
 * arrivée depuis « Payer maintenant » avec ?tour=…).
 */
export default function PayFlowPage() {
  const query = useMyGroups();
  const online = useOnline();
  const [params] = useSearchParams();
  const requested = params.get('tour');
  const dues = duesOf(query.data ?? []);

  // Cotisation choisie : celle demandée dans l'adresse, ou la seule due.
  const [roundId, setRoundId] = useState<string | null>(requested);
  const [method, setMethod] = useState<Method>('wave');
  const [step, setStep] = useState<Step | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <PageTitle>Payer</PageTitle>
        <ListSkeleton rows={2} />
      </div>
    );
  }
  if (query.isError) return <ErrorBlock onRetry={() => void query.refetch()} />;

  if (dues.length === 0) {
    return (
      <div className="flex flex-col gap-4 motion-safe:animate-fade-in">
        <PageTitle>Payer</PageTitle>
        <EmptyState
          title="Rien à payer pour le moment"
          description="Toutes tes cotisations en cours sont réglées."
          action={
            <Link
              to="/historique"
              className="flex min-h-[48px] items-center justify-center rounded-lg border border-slate-300 text-[15px] font-semibold hover:border-blue-700 hover:text-blue-700"
            >
              Voir mon historique
            </Link>
          }
        />
      </div>
    );
  }

  const selected =
    dues.find((d) => d.round.id === roundId) ?? (dues.length === 1 ? dues[0] : undefined);
  // Étape de départ : on saute le choix si la cotisation est déjà connue.
  const current: Step = step ?? (selected ? 2 : 1);

  const pay = async () => {
    if (!selected) return;
    setSending(true);
    setError(undefined);
    try {
      const { checkoutUrl } = await paymentService.initiatePayment({
        roundId: selected.round.id,
        method,
      });
      // Page sécurisée du service de paiement ; il nous renverra sur la page de résultat.
      // Cet aller-retour recharge l'appli : la marque évite qu'elle redemande le PIN.
      markPaymentRedirect();
      window.location.assign(checkoutUrl);
    } catch (err) {
      setError(errorMessage(err));
      setSending(false);
    }
  };

  const back = () => setStep(current === 3 ? 2 : 1);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-3">
        <div className="flex min-h-[44px] items-center gap-1">
          {current > 1 && !(current === 2 && dues.length === 1) ? (
            <button
              type="button"
              onClick={back}
              aria-label="Étape précédente"
              className="-ml-2 flex h-11 w-11 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
          ) : null}
          <h1 className="text-[18px] font-bold leading-6">{STEP_TITLES[current]}</h1>
        </div>
        <StepIndicator step={current} />
      </header>

      {/* La clé change à chaque étape : l'écran glisse en douceur. */}
      <div key={current} className="flex flex-col gap-4 motion-safe:animate-fade-in">
        {current === 1 ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">Cotisation à payer</legend>
            {dues.map((due) => (
              <ChoiceRow
                key={due.round.id}
                name="due"
                checked={selected?.round.id === due.round.id}
                onChange={() => setRoundId(due.round.id)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">
                    {due.overview.group.name}
                  </span>
                  <span
                    className={cn(
                      'block text-[13px]',
                      due.status === 'late' ? 'font-semibold text-amber-700' : 'text-slate-600',
                    )}
                  >
                    {periodLabel(due.overview, due.round)} · {deadlineLabel(due.round.dueDate)}
                  </span>
                </span>
                <AmountDisplay value={due.amount} />
              </ChoiceRow>
            ))}
          </fieldset>
        ) : null}

        {current === 2 ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">Moyen de paiement</legend>
            {selected ? (
              <p className="mb-2 text-[13px] text-slate-600">
                {selected.overview.group.name} ·{' '}
                <AmountDisplay value={selected.amount} className="text-slate-900" /> avant le{' '}
                {shortDate(selected.round.dueDate)}
              </p>
            ) : null}
            {METHODS.map((m) => (
              <ChoiceRow
                key={m.id}
                name="method"
                checked={method === m.id}
                onChange={() => setMethod(m.id)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold">{m.name}</span>
                  <span className="block text-[13px] text-slate-600">{m.detail}</span>
                </span>
              </ChoiceRow>
            ))}
          </fieldset>
        ) : null}

        {current === 3 && selected ? (
          <>
            <Summary due={selected} method={method} />
            <p className="flex items-start gap-2 text-[13px] leading-5 text-slate-600">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-700" aria-hidden="true" />
              Tu vas valider le paiement sur la page sécurisée de{' '}
              {METHODS.find((m) => m.id === method)?.name}. Les frais de paiement sont inclus dans
              le total.
            </p>
            {error ? (
              <p
                role="alert"
                className="rounded-lg bg-danger-bg px-4 py-3 text-[13px] font-semibold text-danger"
              >
                {error}
              </p>
            ) : null}
          </>
        ) : null}
      </div>

      {/* Un seul bouton principal par étape, toujours en bas sur téléphone (au-dessus de la barre). */}
      <BottomAction>
        {current === 3 ? (
          <Button block loading={sending} disabled={!online} onClick={() => void pay()}>
            {online ? (
              <>
                Payer <AmountDisplay value={selected ? totalToPay(selected) : 0} />
              </>
            ) : (
              'Connexion requise pour payer'
            )}
          </Button>
        ) : (
          <Button
            block
            disabled={current === 1 && !selected}
            onClick={() => setStep(current === 1 ? 2 : 3)}
          >
            Continuer
          </Button>
        )}
      </BottomAction>
    </div>
  );
}
