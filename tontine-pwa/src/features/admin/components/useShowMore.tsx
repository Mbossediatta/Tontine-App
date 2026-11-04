import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';

/**
 * Affiche une longue liste par tranches (`pageSize` éléments, puis « Voir plus »).
 * Revient à la première tranche quand `resetKey` change (nouveaux filtres).
 */
export function useShowMore<T>(items: T[], pageSize: number, resetKey: unknown) {
  const [limit, setLimit] = useState(pageSize);
  useEffect(() => setLimit(pageSize), [resetKey, pageSize]);
  const remaining = items.length - limit;
  const more =
    remaining > 0 ? (
      <Button variant="outline" onClick={() => setLimit((value) => value + pageSize)}>
        Voir plus ({remaining} restant{remaining > 1 ? 's' : ''})
      </Button>
    ) : null;
  return { visible: items.slice(0, limit), more };
}
