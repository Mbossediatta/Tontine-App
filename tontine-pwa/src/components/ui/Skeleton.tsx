import { cn } from '@/lib/cn';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-control bg-blue-100', className)}
    />
  );
}

/** Bloc de chargement générique pour une page : quelques cartes. */
export function PageSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Chargement">
      <Skeleton className="h-8 w-1/2" />
      {Array.from({ length: cards }, (_, index) => (
        <Skeleton key={index} className="h-28 w-full rounded-card" />
      ))}
    </div>
  );
}
