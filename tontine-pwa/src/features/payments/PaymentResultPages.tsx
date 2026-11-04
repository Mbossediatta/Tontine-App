import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Clock, Download, Loader2, Share2, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AmountDisplay } from '@/features/member/ui/AmountDisplay';
import { Button } from '@/features/member/ui/Button';
import { Card } from '@/features/member/ui/Card';
import { useCurrentUser } from '@/hooks/useAuth';
import { cn } from '@/lib/cn';
import { formatAmount, formatDateTime, fullName, paymentMethodLabel } from '@/lib/format';
import { queryKeys } from '@/lib/query';
import { paymentService } from '@/services';
import type { PaymentReceipt, User } from '@/types';
import {
  buildPaymentReceipt,
  downloadPaymentReceipt,
  paymentReceiptFileName,
  type PaymentReceiptData,
} from './receipts';

/** Le service de paiement confirme en quelques secondes : on interroge régulièrement. */
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_MS = 60_000;

/** Statut du paiement interrogé jusqu'à confirmation (ou abandon au bout d'une minute). */
function useReceipt() {
  const [params] = useSearchParams();
  const paymentId = params.get('payment') ?? '';
  const startedAt = useRef(Date.now());
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setTimedOut(true), POLL_MAX_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const query = useQuery({
    queryKey: queryKeys.receipt(paymentId),
    queryFn: () => paymentService.getReceipt(paymentId),
    enabled: paymentId !== '',
    refetchInterval: (q) => {
      const status = q.state.data?.payment.status;
      if (status && status !== 'pending') return false;
      return Date.now() - startedAt.current < POLL_MAX_MS ? POLL_INTERVAL_MS : false;
    },
  });
  return { query, timedOut };
}

function receiptData(receipt: PaymentReceipt, user: User): PaymentReceiptData {
  const { payment } = receipt;
  return {
    paymentId: payment.id,
    payerName: fullName(user),
    payerPhone: user.phone,
    groupName: receipt.groupName,
    cycle: receipt.cycle,
    roundNumber: receipt.roundNumber,
    amount: payment.amount,
    method: payment.method,
    providerRef: payment.providerRef,
    paidAt: payment.paidAt ?? new Date().toISOString(),
  };
}

/**
 * Partage du reçu : le fichier PDF lui-même si le téléphone le permet (menu de
 * partage natif, qui propose WhatsApp), sinon un message WhatsApp avec les détails.
 */
async function shareReceipt(receipt: PaymentReceipt, user: User): Promise<void> {
  const data = receiptData(receipt, user);
  const text = `Reçu Calebasse de l’Espoir : ${formatAmount(data.amount)} payés pour « ${data.groupName} » (tour ${data.roundNumber}). Réf. ${data.providerRef ?? data.paymentId}.`;
  const bytes = buildPaymentReceipt(data);
  const file = new File([bytes as Uint8Array<ArrayBuffer>], paymentReceiptFileName(data), {
    type: 'application/pdf',
  });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return;
    } catch {
      return; // partage annulé par l'utilisateur : rien à faire
    }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}

/** Mise en page des écrans de résultat (hors de la barre de navigation). */
function ResultLayout({ children }: { children: ReactNode }) {
  return (
    <main className="theme-member flex min-h-[100dvh] justify-center bg-blue-50 px-4 py-8 sm:items-center">
      <div className="flex w-full max-w-md flex-col gap-4 motion-safe:animate-fade-in">{children}</div>
    </main>
  );
}

/** Pastille ronde d'état : vert (réussi), rouge (échoué), bleu (en cours). */
function StateIcon({ tone, children }: { tone: 'success' | 'error' | 'pending'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'flex h-16 w-16 items-center justify-center rounded-full',
        tone === 'success' && 'bg-green-100 text-green-700',
        tone === 'error' && 'bg-danger-bg text-danger',
        tone === 'pending' && 'bg-blue-100 text-blue-700',
      )}
    >
      {children}
    </span>
  );
}

/** Détails du paiement en tableau compact. */
function PaymentDetails({ receipt }: { receipt: PaymentReceipt }) {
  const { payment } = receipt;
  const rows: Array<[string, string]> = [
    ['Groupe', `${receipt.groupName} · tour ${receipt.roundNumber}`],
    ['Moyen', paymentMethodLabel(payment.method)],
    ['Référence', payment.providerRef ?? payment.id.toUpperCase()],
  ];
  if (payment.paidAt) rows.push(['Date', formatDateTime(payment.paidAt)]);
  return (
    <dl className="divide-y divide-slate-200 border-t border-slate-200">
      {rows.map(([label, value]) => (
        <div key={label} className="flex min-h-[44px] items-center justify-between gap-4 py-2">
          <dt className="text-[13px] text-slate-600">{label}</dt>
          <dd className="text-right text-[15px] font-semibold">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Retour du service de paiement : on attend la confirmation du serveur, puis on
 * affiche le résultat. Même écran pour /paiement/succes et /paiement/echec : c'est
 * le statut réel du paiement qui décide, pas l'adresse.
 */
export function PaymentResultPage() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const { query, timedOut } = useReceipt();
  const [sharing, setSharing] = useState(false);

  if (query.isPending) {
    return (
      <ResultLayout>
        <Card className="flex flex-col items-center gap-3 px-6 py-8 text-center" role="status">
          <Loader2 className="h-8 w-8 text-blue-700 motion-safe:animate-spin" aria-hidden="true" />
          <p className="text-[15px] font-semibold">Chargement du paiement…</p>
        </Card>
      </ResultLayout>
    );
  }
  if (query.isError || !query.data) {
    return (
      <ResultLayout>
        <Card className="flex flex-col gap-4 px-6 py-8 text-center">
          <p className="text-[18px] font-bold">Paiement introuvable</p>
          <p className="text-[13px] text-slate-600">Retrouve tous tes paiements dans ton historique.</p>
          <Button block onClick={() => navigate('/historique', { replace: true })}>
            Voir mon historique
          </Button>
        </Card>
      </ResultLayout>
    );
  }

  const receipt = query.data;
  const { payment } = receipt;
  const retryLink = `/payer?tour=${payment.roundId}`;

  // --- Réussi : référence, reçu à télécharger ou à partager ---
  if (payment.status === 'paid') {
    return (
      <ResultLayout>
        <Card className="flex flex-col gap-4 px-6 py-6" aria-live="polite">
          <div className="flex flex-col items-center gap-3 text-center">
            <StateIcon tone="success">
              <Check className="h-8 w-8" strokeWidth={2.5} aria-hidden="true" />
            </StateIcon>
            <h1 className="text-[18px] font-bold">Paiement réussi</h1>
            <AmountDisplay value={payment.amount} size="xl" className="text-green-700" />
          </div>
          <PaymentDetails receipt={receipt} />
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              icon={<Download className="h-4 w-4" aria-hidden="true" />}
              onClick={() => downloadPaymentReceipt(receiptData(receipt, user))}
            >
              Reçu PDF
            </Button>
            <Button
              variant="secondary"
              loading={sharing}
              icon={<Share2 className="h-4 w-4" aria-hidden="true" />}
              onClick={async () => {
                setSharing(true);
                await shareReceipt(receipt, user);
                setSharing(false);
              }}
            >
              WhatsApp
            </Button>
          </div>
        </Card>
        <Button block onClick={() => navigate('/', { replace: true })}>
          Terminé
        </Button>
      </ResultLayout>
    );
  }

  // --- Échoué : message humain, et réessayer ---
  if (payment.status === 'failed') {
    return (
      <ResultLayout>
        <Card className="flex flex-col items-center gap-3 px-6 py-6 text-center" aria-live="polite">
          <StateIcon tone="error">
            <X className="h-8 w-8" strokeWidth={2.5} aria-hidden="true" />
          </StateIcon>
          <h1 className="text-[18px] font-bold">Le paiement n’a pas abouti</h1>
          <p className="text-[15px] leading-6 text-slate-600">
            Aucun montant n’a été prélevé. Vérifie ton solde {paymentMethodLabel(payment.method)},
            ou essaie avec un autre moyen de paiement.
          </p>
        </Card>
        <Button block onClick={() => navigate(retryLink, { replace: true })}>
          Réessayer
        </Button>
        <Link
          to="/"
          replace
          className="flex min-h-[44px] items-center justify-center rounded-lg text-[15px] font-semibold text-blue-700 hover:bg-blue-50"
        >
          Retour à l’accueil
        </Link>
      </ResultLayout>
    );
  }

  // --- En cours : le service de paiement n'a pas encore confirmé ---
  return (
    <ResultLayout>
      <Card className="flex flex-col items-center gap-3 px-6 py-6 text-center" aria-live="polite">
        <StateIcon tone="pending">
          {timedOut ? (
            <Clock className="h-8 w-8" aria-hidden="true" />
          ) : (
            <Loader2 className="h-8 w-8 motion-safe:animate-spin" aria-hidden="true" />
          )}
        </StateIcon>
        <h1 className="text-[18px] font-bold">
          {timedOut ? 'Paiement en cours de vérification' : 'Confirmation en cours'}
        </h1>
        <AmountDisplay value={payment.amount} size="md" />
        <p className="text-[15px] leading-6 text-slate-600">
          {timedOut
            ? 'La confirmation prend plus de temps que prévu. Tu recevras une notification dès qu’elle arrive.'
            : `${paymentMethodLabel(payment.method)} confirme ton paiement, cela prend quelques secondes.`}
        </p>
      </Card>
      {timedOut ? (
        <Button block onClick={() => navigate('/', { replace: true })}>
          Retour à l’accueil
        </Button>
      ) : null}
    </ResultLayout>
  );
}

/** Adresses de retour du service de paiement : le même écran décide selon le statut réel. */
export const PaymentSuccessPage = PaymentResultPage;
export const PaymentFailurePage = PaymentResultPage;
