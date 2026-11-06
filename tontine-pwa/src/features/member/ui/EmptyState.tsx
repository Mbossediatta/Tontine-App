import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Forme de calebasse (bol arrondi avec son rebord), en simple trait : la touche
 * identitaire de l'application, utilisée discrètement (états vides, carte principale).
 */
export function CalabashShape({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 80" fill="none" className={className} aria-hidden="true">
      <path d="M6 26c0 30 24 48 54 48s54-18 54-48" stroke="currentColor" strokeWidth="2.5" />
      <ellipse cx="60" cy="26" rx="54" ry="12" stroke="currentColor" strokeWidth="2.5" />
      <path
        d="M20 50l8 6 8-6 8 6 8-6 8 6 8-6 8 6 8-6 8 6 8-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/** État vide : petite calebasse en trait, une phrase concrète, et l'action utile. */
export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-300 px-6 py-8 text-center',
        className,
      )}
    >
      <CalabashShape className="h-10 w-16 text-green-400" />
      <p className="text-[15px] font-semibold text-slate-900">{title}</p>
      {description ? (
        <p className="max-w-xs text-[13px] leading-5 text-slate-600">{description}</p>
      ) : null}
      {action ? <div className="mt-1 w-full max-w-xs">{action}</div> : null}
    </div>
  );
}

/** Message d'erreur de chargement, avec « Réessayer ». */
export function ErrorBlock({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-xl border border-slate-200 bg-white px-6 py-8 text-center"
    >
      <p className="text-[15px] font-semibold text-slate-900">Impossible de charger les données</p>
      <p className="text-[13px] text-slate-600">Vérifie ta connexion, puis réessaie.</p>
      <button
        type="button"
        onClick={onRetry}
        className="min-h-[44px] rounded-lg px-4 text-[15px] font-semibold text-blue-700 hover:bg-blue-50"
      >
        Réessayer
      </button>
    </div>
  );
}
