import type React from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, ErrorState, Skeleton } from '@/components/ui';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';

export function PageFrame({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={title} subtitle={subtitle} plain />
      {children}
    </div>
  );
}

/** Chargement (squelette) ou erreur (message + « Réessayer ») d'une requête ; sinon le contenu. */
export function QueryState({
  query,
  children,
}: {
  query: {
    isPending: boolean;
    isError: boolean;
    error: Error | null;
    refetch: () => unknown;
  };
  children: React.ReactNode;
}) {
  if (query.isPending) {
    return (
      <div role="status" aria-label="Chargement" className="flex flex-col gap-3">
        <Skeleton className="h-24 w-full rounded-card" />
        <Skeleton className="h-24 w-full rounded-card" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <ErrorState
        message={`Impossible de charger cette rubrique. ${errorMessage(query.error)}`}
        onRetry={() => void query.refetch()}
      />
    );
  }
  return children;
}

export function Stat({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('flex flex-col gap-1', className)}>
      <span className="text-label text-muted">{label}</span>
      <strong className="font-display text-section tabular-nums text-blue-900">{value}</strong>
    </Card>
  );
}
