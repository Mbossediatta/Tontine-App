import { cn } from '@/lib/cn';

const formatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

interface AmountDisplayProps {
  value: number;
  /** sm : dans une ligne · md : chiffre clé · xl : montant vedette (carte de cotisation). */
  size?: 'sm' | 'md' | 'xl';
  /** Signe affiché devant : « − » pour une cotisation versée, « + » pour une cagnotte reçue. */
  sign?: '+' | '−';
  className?: string;
}

const SIZES = {
  sm: 'text-[15px] font-semibold',
  md: 'text-[18px] font-bold',
  xl: 'text-[30px] font-bold leading-9 tracking-tight',
} as const;

/**
 * Montant formaté à la sénégalaise (« 4 500 FCFA ») en chiffres tabulaires, pour que
 * les montants s'alignent en colonne. L'unité est plus petite et plus discrète.
 */
export function AmountDisplay({ value, size = 'sm', sign, className }: AmountDisplayProps) {
  return (
    <span className={cn('whitespace-nowrap tabular-nums', SIZES[size], className)}>
      {sign ? `${sign} ` : ''}
      {formatter.format(Math.round(value))}
      <span className={cn('ml-1 font-semibold', size === 'xl' ? 'text-[15px]' : 'text-[13px]')}>
        FCFA
      </span>
    </span>
  );
}
