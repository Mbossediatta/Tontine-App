import { AlertCircle, Check, Clock, RotateCcw, XCircle, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { PaymentStatus } from '@/types';

/**
 * Pastille de statut : seul élément en forme de pilule. Toujours une icône ET un mot,
 * jamais la couleur seule. Vert = payé, ambre = en retard, rouge = échec.
 */
const PILLS: Record<PaymentStatus, { label: string; className: string; Icon: LucideIcon }> = {
  paid: { label: 'Payé', className: 'bg-green-100 text-green-700', Icon: Check },
  pending: { label: 'À payer', className: 'bg-slate-100 text-slate-700', Icon: Clock },
  late: { label: 'En retard', className: 'bg-amber-100 text-amber-700', Icon: AlertCircle },
  failed: { label: 'Échoué', className: 'bg-danger-bg text-danger', Icon: XCircle },
  refunded: { label: 'Remboursé', className: 'bg-slate-100 text-slate-700', Icon: RotateCcw },
};

export function StatusPill({
  status,
  label,
  className,
}: {
  status: PaymentStatus;
  /** Remplace le libellé par défaut (ex. « Reçu » pour une cagnotte). */
  label?: string;
  className?: string;
}) {
  const { label: defaultLabel, className: tone, Icon } = PILLS[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[13px] font-semibold leading-4',
        tone,
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden="true" />
      {label ?? defaultLabel}
    </span>
  );
}
