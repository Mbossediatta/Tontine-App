import type { ReactNode } from 'react';
import { ErrorState } from './EmptyState';
import { PageSkeleton } from './Skeleton';

interface AsyncContentProps<T> {
  query: {
    data: T | undefined;
    isPending: boolean;
    isError: boolean;
    refetch: () => unknown;
  };
  skeleton?: ReactNode;
  errorMessage?: string;
  children: (data: T) => ReactNode;
}

/** Gère les états chargement / erreur d'une requête, puis affiche les données. */
export function AsyncContent<T>({ query, skeleton, errorMessage, children }: AsyncContentProps<T>) {
  if (query.isPending) return <>{skeleton ?? <PageSkeleton />}</>;
  if (query.isError || query.data === undefined) {
    return <ErrorState message={errorMessage} onRetry={() => void query.refetch()} />;
  }
  return <>{children(query.data)}</>;
}
