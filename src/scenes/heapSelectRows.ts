// src/scenes/heapSelectRows.ts
//
// Row → heap mapping for HeapSelectScene. Pure so the Tutorial-row offset is
// tested in one place instead of re-derived at every call site.
//
// While the tutorial is pending, row 0 is the Tutorial and heap `sorted[i]`
// sits at row `i + rowOffset` (rowOffset = 1); otherwise rowOffset = 0.

/** The heap at `row`, or undefined for the Tutorial row / past the end. */
export function heapAtRow<T>(sorted: readonly T[], row: number, rowOffset: number): T | undefined {
  return row < rowOffset ? undefined : sorted[row - rowOffset];
}

/** Whether `row` is the one the menu currently has selected. While the
 *  tutorial is pending that is the Tutorial row, not activeId's heap — the
 *  real heap is only loaded underneath it (see menuStartRoute.ts). */
export function isActiveRow(
  sorted: readonly { id: string }[], row: number, rowOffset: number, activeId: string,
): boolean {
  if (rowOffset > 0) return row < rowOffset;
  return sorted[row]?.id === activeId;
}
