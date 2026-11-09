import type { PageCursor } from '@/types';

/** Ordre du serveur : du plus récent au plus ancien, puis par id décroissant. */
function before(a: PageCursor, b: PageCursor): boolean {
  return a.at < b.at || (a.at === b.at && a.id < b.id);
}

/**
 * Découpe une liste comme le fait le serveur (pagination par curseur) : trie du plus
 * récent au plus ancien, reprend après `cursor`, renvoie `limit` lignes et la suite.
 */
export function pageOf<T>(
  items: T[],
  cursorOf: (item: T) => PageCursor,
  cursor?: PageCursor,
  limit = 50,
): { rows: T[]; next?: PageCursor } {
  const sorted = [...items].sort((a, b) => {
    const left = cursorOf(a);
    const right = cursorOf(b);
    return before(left, right) ? 1 : before(right, left) ? -1 : 0;
  });
  const after = cursor ? sorted.filter((item) => before(cursorOf(item), cursor)) : sorted;
  const rows = after.slice(0, limit);
  const last = rows[rows.length - 1];
  return { rows, next: after.length > limit && last ? cursorOf(last) : undefined };
}
