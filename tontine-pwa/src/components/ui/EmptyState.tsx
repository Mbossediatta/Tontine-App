import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';
import { Logo } from './Logo';

interface EmptyStateProps {
  title: string;
  description?: string;
  /** Un bouton d'action principal (vert). */
  action?: ReactNode;
}

/** État vide : calebasse, titre bleu foncé, phrase courte, un bouton. */
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card bg-white px-6 py-10 text-center shadow-card">
      <Logo size={88} decorative className="opacity-90" />
      <p className="font-display text-section text-blue-900">{title}</p>
      {description ? <p className="max-w-xs text-body text-muted">{description}</p> : null}
      {action ? <div className="mt-2 w-full sm:w-auto">{action}</div> : null}
    </div>
  );
}

interface ErrorStateProps {
  message?: string;
  onRetry: () => void;
}

export function ErrorState({
  message = 'Impossible de charger les données.',
  onRetry,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-card bg-white px-6 py-10 text-center shadow-card"
    >
      <AlertTriangle className="h-8 w-8 text-danger" aria-hidden="true" />
      <p className="text-body text-ink">{message}</p>
      <Button variant="secondary" onClick={onRetry}>
        Réessayer
      </Button>
    </div>
  );
}
