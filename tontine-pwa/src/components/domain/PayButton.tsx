import { Wallet } from 'lucide-react';
import { OnlineButton } from '@/components/layout/OnlineButton';
import { formatAmount } from '@/lib/format';

interface PayButtonProps {
  amount: number;
  onClick: () => void;
  loading?: boolean;
  label?: string;
}

/** Bouton vert « Payer [montant] », pleine largeur, désactivé hors ligne. */
export function PayButton({ amount, onClick, loading, label = 'Payer' }: PayButtonProps) {
  return (
    <OnlineButton
      variant="primary"
      className="w-full"
      loading={loading}
      loadingText="Paiement en cours…"
      onClick={onClick}
      icon={<Wallet className="h-5 w-5" aria-hidden="true" />}
    >
      <span className="tabular-nums">
        {label} {formatAmount(amount)}
      </span>
    </OnlineButton>
  );
}
