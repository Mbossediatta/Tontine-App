import { AlertCircle, Check, Clock, RotateCcw, Shield, Star, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge, type BadgeTone } from '@/components/ui';
import type { PaymentStatus } from '@/types';

export type StatusKind = PaymentStatus | 'my_turn' | 'admin';

const iconClass = 'h-3.5 w-3.5';

const CONFIG: Record<StatusKind, { label: string; tone: BadgeTone; icon: ReactNode }> = {
  paid: {
    label: 'Payé',
    tone: 'success',
    icon: <Check className={iconClass} aria-hidden="true" />,
  },
  pending: {
    label: 'En attente',
    tone: 'warning',
    icon: <Clock className={iconClass} aria-hidden="true" />,
  },
  late: {
    label: 'En retard',
    tone: 'danger',
    icon: <AlertCircle className={iconClass} aria-hidden="true" />,
  },
  failed: {
    label: 'Échoué',
    tone: 'danger',
    icon: <XCircle className={iconClass} aria-hidden="true" />,
  },
  refunded: {
    label: 'Remboursé',
    tone: 'neutral',
    icon: <RotateCcw className={iconClass} aria-hidden="true" />,
  },
  my_turn: {
    label: 'Ton tour',
    tone: 'info',
    icon: <Star className={iconClass} aria-hidden="true" />,
  },
  admin: {
    label: 'Admin',
    tone: 'admin',
    icon: <Shield className={iconClass} aria-hidden="true" />,
  },
};

/** Badge de statut : toujours texte + icône, jamais la couleur seule. */
export function StatusBadge({ status, label }: { status: StatusKind; label?: string }) {
  const config = CONFIG[status];
  return (
    <Badge tone={config.tone} icon={config.icon}>
      {label ?? config.label}
    </Badge>
  );
}
