import { cn } from '@/lib/cn';
import { formatAmount } from '@/lib/format';

type AmountTone = 'inherit' | 'due' | 'received';
type AmountSize = 'inherit' | 'secondary' | 'main';

interface AmountTextProps {
  value: number;
  /** due : à payer (bleu foncé) · received : reçu (vert). */
  tone?: AmountTone;
  /** main : Baloo 2 34 px · secondary : 17 px gras. */
  size?: AmountSize;
  className?: string;
}

const TONES: Record<AmountTone, string> = {
  inherit: '',
  due: 'text-blue-900',
  received: 'text-green-700',
};

const SIZES: Record<AmountSize, string> = {
  inherit: '',
  secondary: 'text-card-title',
  main: 'font-display text-amount',
};

/** Montant formaté « 45 000 FCFA » en chiffres tabulaires. */
export function AmountText({
  value,
  tone = 'inherit',
  size = 'inherit',
  className,
}: AmountTextProps) {
  return (
    <span className={cn('whitespace-nowrap tabular-nums', TONES[tone], SIZES[size], className)}>
      {formatAmount(value)}
    </span>
  );
}
