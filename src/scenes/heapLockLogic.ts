/**
 * Pure lock-state resolver for HeapSelectScene, extracted so it can be
 * unit-tested without a live Phaser scene (the scene classes import Phaser as
 * a value, which the Node test env can't load — same pattern as
 * heapSelectStats.ts).
 *
 * A heap is locked iff its lockedByHeapId is set, that heap exists in the
 * catalog, and the player has not beaten it. Fail open: a dangling pointer
 * (prerequisite deleted server-side) never locks a heap.
 */

export interface LockableHeap {
  id: string;
  params: { name: string; lockedByHeapId?: string | null };
}

export type LockState = { locked: false } | { locked: true; prereqName: string };

export function getLockState(
  heap: LockableHeap,
  catalog: readonly LockableHeap[],
  beatenIds: readonly string[],
): LockState {
  const prereqId = heap.params.lockedByHeapId;
  if (!prereqId) return { locked: false };
  const prereq = catalog.find((h) => h.id === prereqId);
  if (!prereq) return { locked: false };  // dangling pointer — fail open
  if (beatenIds.includes(prereqId)) return { locked: false };
  return { locked: true, prereqName: prereq.params.name };
}
