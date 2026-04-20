import { describe, it, expect } from 'vitest';
import { buildColumnEntries, appendColumnEntries } from '../InfiniteColumnGenerator';
import { MOCK_HEAP_HEIGHT_PX, CHUNK_BAND_HEIGHT } from '../../constants';
import { OBJECT_DEFS } from '../../data/heapObjectDefs';

describe('buildColumnEntries', () => {
  it('generates entries with x within [xMin, xMax]', () => {
    const entries = buildColumnEntries(42, 100, 500, 50);
    for (const e of entries) {
      expect(e.x).toBeGreaterThanOrEqual(100);
      expect(e.x).toBeLessThanOrEqual(500);
    }
  });

  it('generates the requested number of entries', () => {
    const entries = buildColumnEntries(42, 0, 960, 100);
    expect(entries.length).toBe(100);
  });

  it('is deterministic for the same seed', () => {
    const a = buildColumnEntries(42, 0, 960, 20);
    const b = buildColumnEntries(42, 0, 960, 20);
    expect(a).toEqual(b);
  });

  it('produces different entries for different seeds', () => {
    const a = buildColumnEntries(1, 0, 960, 10);
    const b = buildColumnEntries(2, 0, 960, 10);
    expect(a[0].x).not.toBe(b[0].x);
  });

  it('all entries have valid keyid (≥ 0)', () => {
    const entries = buildColumnEntries(7, 0, 960, 30);
    for (const e of entries) {
      expect(e.keyid).toBeGreaterThanOrEqual(0);
    }
  });
});

// ─── Extension surface diagnostics ───────────────────────────────────────────

const SEED     = 42;
const X_MIN    = 0;
const X_MAX    = 500;
const INITIAL  = 300;
const EXTEND   = 200;

function entryTopY(e: { y: number; keyid: number }): number {
  const def = OBJECT_DEFS[e.keyid] ?? OBJECT_DEFS[0];
  return e.y - def.height / 2;
}

describe('appendColumnEntries — surface quality', () => {
  const initial  = buildColumnEntries(SEED, X_MIN, X_MAX, INITIAL);
  const extended = appendColumnEntries(SEED, X_MIN, X_MAX, INITIAL, initial, EXTEND);

  const initialTopY   = Math.min(...initial.map(entryTopY));
  const initialBotY   = Math.max(...initial.map(entryTopY));
  const extendedTopYs = extended.map(entryTopY);

  it('produces close to the requested number of extension entries', () => {
    // With fallback surface, almost no blocks should be skipped
    expect(extended.length).toBeGreaterThanOrEqual(Math.floor(EXTEND * 0.95));
  });

  it('no extended entry lands at the world floor', () => {
    for (const e of extended) {
      expect(e.y).toBeLessThan(MOCK_HEAP_HEIGHT_PX - 100);
    }
  });

  it('all extended entries are above the initial heap bottom', () => {
    // Extension blocks should grow the heap upward, not pile onto the base
    for (const topY of extendedTopYs) {
      expect(topY).toBeLessThan(initialBotY);
    }
  });

  it('extension blocks build upward — all above the initial heap bottom', () => {
    // Every extension block should be somewhere above (lower Y) the bottom half
    // of the initial heap. If blocks fall to the world floor they'd be near
    // MOCK_HEAP_HEIGHT_PX, far below the initial surface.
    const sortedInitial = [...initial].sort((a, b) => entryTopY(a) - entryTopY(b));
    const initialMedianY = sortedInitial[Math.floor(sortedInitial.length / 2)];
    for (const topY of extendedTopYs) {
      expect(topY).toBeLessThan(entryTopY(initialMedianY));
    }
  });

  it('extension grows the heap upward — topmost extended block is above initial topY', () => {
    // The extension should raise the heap; the highest extended block should
    // be strictly higher (lower Y) than the initial heap top.
    const extMin = Math.min(...extendedTopYs);
    expect(extMin).toBeLessThan(initialTopY);
  });

  it('extension blocks land within one band of the initial heap top (no zig-zag scatter)', () => {
    // The core anti-zig-zag invariant: all extension blocks must have their top
    // edge within CHUNK_BAND_HEIGHT below the initial heap top. Blocks scattered
    // more than one band below create alternating narrow/wide polygon bands.
    for (const topY of extendedTopYs) {
      // topY can be ABOVE initialTopY (block stacks higher than initial top) — fine
      // topY must not be MORE than one band BELOW initialTopY
      expect(topY).toBeLessThanOrEqual(initialTopY + CHUNK_BAND_HEIGHT);
    }
  });
});
