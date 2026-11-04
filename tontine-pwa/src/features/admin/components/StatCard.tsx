import type { ReactNode } from 'react';
import { Card } from '@/components/ui';
import { cn } from '@/lib/cn';

/** Couleur de la précision sous le chiffre : neutre, bonne nouvelle (vert) ou à surveiller (orange). */
export type StatHintTone = 'muted' | 'positive' | 'warning';

const HINT_TONES: Record<StatHintTone, string> = {
  muted: 'text-muted',
  positive: 'text-green-700',
  warning: 'text-warning',
};

interface StatCardProps {
  label: string;
  value: ReactNode;
  /** Précision sous le chiffre (ex. « sur 162 000 FCFA attendus »). */
  hint?: ReactNode;
  hintTone?: StatHintTone;
  icon?: ReactNode;
}

/**
 * Indicateur du tableau de bord : libellé en haut (icône à droite), chiffre en
 * Baloo 2, précision colorée en dessous.
 */
export function StatCard({ label, value, hint, hintTone = 'muted', icon }: StatCardProps) {
  return (
    <Card className="flex flex-col gap-1">
      <div className="flex items-start justify-between gap-2">
        <span className="text-label text-muted">{label}</span>
        {icon ? (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700">
            {icon}
          </span>
        ) : null}
      </div>
      {/* Plus petit sur mobile : un montant comme « 1 147 500 FCFA » doit tenir dans une demi-largeur. */}
      <span className="break-words font-display text-[22px] font-extrabold leading-7 tabular-nums text-blue-900 sm:text-stat">
        {value}
      </span>
      {hint ? <span className={cn('text-small', HINT_TONES[hintTone])}>{hint}</span> : null}
    </Card>
  );
}
