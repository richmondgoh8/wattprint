// Shared sortable-table helpers (Live, TopConsumers, Info).

type SortDir = 'asc' | 'desc';

/** Next sort state for a header click: flip on repeat, else first-click
 *  direction (text keys ascend, numeric keys descend). */
export function nextSort<T extends string>(sortKey: T, sortDir: SortDir, key: T, textKeys: readonly T[] = []): { key: T; dir: SortDir } {
  if (sortKey === key) {
    return { key, dir: sortDir === 'asc' ? 'desc' : 'asc' };
  }
  return { key, dir: textKeys.includes(key) ? 'asc' : 'desc' };
}

export function sortIndicator<T extends string>(key: T, sortKey: T, sortDir: SortDir): string {
  if (sortKey !== key) return '';
  return sortDir === 'asc' ? '▲' : '▼';
}

/** aria-sort value for a header cell (none unless it is the active sort). */
export function ariaSort<T extends string>(key: T, sortKey: T, sortDir: SortDir): 'ascending' | 'descending' | 'none' {
  if (sortKey !== key) return 'none';
  return sortDir === 'asc' ? 'ascending' : 'descending';
}
