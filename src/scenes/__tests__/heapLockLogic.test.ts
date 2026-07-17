import { describe, it, expect } from 'vitest';
import { getLockState, type LockableHeap } from '../heapLockLogic';

const heap = (id: string, name: string, lockedByHeapId?: string | null): LockableHeap =>
  ({ id, params: { name, lockedByHeapId } });

describe('getLockState', () => {
  const easy = heap('easy', 'Easy Heap');
  const hard = heap('hard', 'Hard Heap', 'easy');
  const catalog = [easy, hard];

  it('unlocked when lockedByHeapId is absent or null', () => {
    expect(getLockState(easy, catalog, [])).toEqual({ locked: false });
    expect(getLockState(heap('x', 'X', null), catalog, [])).toEqual({ locked: false });
  });

  it('locked with prerequisite name when prereq exists and is unbeaten', () => {
    expect(getLockState(hard, catalog, [])).toEqual({ locked: true, prereqName: 'Easy Heap' });
  });

  it('unlocked once the prerequisite is beaten', () => {
    expect(getLockState(hard, catalog, ['easy'])).toEqual({ locked: false });
  });

  it('fails open when the prerequisite is missing from the catalog', () => {
    const orphan = heap('orphan', 'Orphan', 'deleted-heap');
    expect(getLockState(orphan, catalog, [])).toEqual({ locked: false });
  });

  it('beating an unrelated heap does not unlock', () => {
    expect(getLockState(hard, catalog, ['hard', 'other'])).toEqual({ locked: true, prereqName: 'Easy Heap' });
  });
});
