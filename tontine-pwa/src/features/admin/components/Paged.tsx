import type { ReactNode } from 'react';
import { useShowMore } from './useShowMore';

/**
 * Version composant de `useShowMore`, pour les listes construites dans un rendu
 * (ex. à l'intérieur d'AsyncContent), où un hook ne peut pas être appelé.
 * Affiche la tranche visible, puis le bouton « Voir plus » s'il reste des éléments.
 */
export function Paged<T>({
  items,
  pageSize = 20,
  resetKey,
  children,
}: {
  items: T[];
  pageSize?: number;
  /** Change quand les filtres changent : on revient à la première tranche. */
  resetKey?: unknown;
  children: (visible: T[]) => ReactNode;
}) {
  const page = useShowMore(items, pageSize, resetKey);
  return (
    <>
      {children(page.visible)}
      {page.more ? <div className="flex justify-center">{page.more}</div> : null}
    </>
  );
}
