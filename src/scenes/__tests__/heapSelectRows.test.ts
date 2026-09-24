import { describe, it, expect } from 'vitest';
import { heapAtRow, isActiveRow } from '../heapSelectRows';

const heaps = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('heapAtRow', () => {
  it('maps rows straight onto heaps with no Tutorial row', () => {
    expect(heapAtRow(heaps, 0, 0)).toEqual({ id: 'a' });
    expect(heapAtRow(heaps, 2, 0)).toEqual({ id: 'c' });
  });

  it('returns no heap for the Tutorial row and shifts the rest down one', () => {
    expect(heapAtRow(heaps, 0, 1)).toBeUndefined();
    expect(heapAtRow(heaps, 1, 1)).toEqual({ id: 'a' });
    expect(heapAtRow(heaps, 3, 1)).toEqual({ id: 'c' });
  });

  it('returns no heap past the end', () => {
    expect(heapAtRow(heaps, 3, 0)).toBeUndefined();
    expect(heapAtRow(heaps, 4, 1)).toBeUndefined();
  });
});

describe('isActiveRow', () => {
  it('marks the active heap row with no Tutorial row', () => {
    expect(heaps.map((_, i) => isActiveRow(heaps, i, 0, 'b'))).toEqual([false, true, false]);
  });

  it('marks only the Tutorial row while it is pending, even though a heap is loaded', () => {
    expect([0, 1, 2, 3].map(i => isActiveRow(heaps, i, 1, 'b'))).toEqual([true, false, false, false]);
  });
});
