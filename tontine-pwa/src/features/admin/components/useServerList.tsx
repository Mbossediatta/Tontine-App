import { useMemo } from 'react';
import { keepPreviousData, useInfiniteQuery, type QueryKey } from '@tanstack/react-query';
import { Button } from '@/components/ui';
import type { ListPage, PageCursor } from '@/types';

/** Lignes demandées au serveur à chaque « Voir plus ». */
const PAGE_SIZE = 50;

type FetchPage<Row, Summary> = (
  cursor: PageCursor | undefined,
  limit: number,
) => Promise<ListPage<Row, Summary>>;

/**
 * Longue liste paginée par le serveur : la première page (avec ses totaux) arrive seule,
 * « Voir plus » demande la suivante. `queryKey` doit contenir les filtres : en changer
 * recharge la première page, la liste précédente restant affichée (pas d'écran vide,
 * les champs de filtre gardent le focus) jusqu'à l'arrivée des nouvelles lignes.
 */
export function useServerList<Row, Summary extends { total: number }>(
  queryKey: QueryKey,
  fetchPage: FetchPage<Row, Summary>,
) {
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam, PAGE_SIZE),
    initialPageParam: undefined as PageCursor | undefined,
    getNextPageParam: (last) => last.next,
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => query.data?.pages.flatMap((page) => page.rows) ?? [], [query.data]);
  const summary = query.data?.pages[0]?.summary;
  const total = summary?.total;
  const remaining = total === undefined ? undefined : Math.max(0, total - rows.length);

  const more = query.hasNextPage ? (
    <div className="flex justify-center">
      <Button
        variant="outline"
        loading={query.isFetchingNextPage}
        onClick={() => void query.fetchNextPage()}
      >
        Voir plus
        {remaining ? ` (${remaining} restant${remaining > 1 ? 's' : ''})` : ''}
      </Button>
    </div>
  ) : null;

  return {
    query,
    rows,
    summary,
    more,
    /** Nouveaux filtres en cours de chargement : l'ancienne liste est encore affichée. */
    updating: query.isPlaceholderData,
  };
}

/** Toutes les lignes correspondant aux filtres (exports CSV / PDF), par pages de 1000. */
export async function fetchAllPages<Row>(fetchPage: FetchPage<Row, unknown>): Promise<Row[]> {
  const rows: Row[] = [];
  let cursor: PageCursor | undefined;
  do {
    const page = await fetchPage(cursor, 1000);
    rows.push(...page.rows);
    cursor = page.next;
  } while (cursor);
  return rows;
}
