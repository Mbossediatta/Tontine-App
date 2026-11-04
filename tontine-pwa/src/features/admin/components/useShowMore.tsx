import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';

/**
 * Affiche une longue liste par tranches (`pageSize` éléments, puis « Voir plus »).
 * Revient à la première tranche quand `resetKey` change (nouveaux filtres).
 * `more` est le bouton du back-office ; `remaining` et `loadMore` permettent à un
 * écran d'afficher son propre bouton (espace participant).
 */
export function useShowMore<T>(items: T[], pageSize: number, resetKey: unknown) {
  const [limit, setLimit] = useState(pageSize);
  useEffect(() => setLimit(pageSize), [resetKey, pageSize]);
  const remaining = Math.max(0, items.length - limit);
  const loadMore = () => setLimit((value) => value + pageSize);
  const more =
    remaining > 0 ? (
      <Button variant="outline" onClick={loadMore}>
        Voir plus ({remaining} restant{remaining > 1 ? 's' : ''})
      </Button>
    ) : null;
  return { visible: items.slice(0, limit), more, remaining, loadMore };
}
