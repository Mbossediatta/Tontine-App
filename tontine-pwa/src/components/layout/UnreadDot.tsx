import { cn } from '@/lib/cn';

/**
 * Point vert de 8 px signalant des notifications non lues.
 * `onSide` : placé sur l'icône du menu latéral (coin haut droit de l'icône).
 */
export function UnreadDot({ count, onSide = false }: { count: number; onSide?: boolean }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        'absolute h-2 w-2 rounded-full bg-green-600 ring-2 ring-white',
        onSide ? '-right-0.5 -top-0.5' : 'right-3 top-0.5',
      )}
    >
      <span className="sr-only">{count} non lues</span>
    </span>
  );
}

/** Compteur (cloche de l'accueil). */
export function UnreadCount({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-pill bg-green-700 px-1 text-[12px] font-bold tabular-nums text-white">
      {count > 9 ? '9+' : count}
      <span className="sr-only"> non lues</span>
    </span>
  );
}
