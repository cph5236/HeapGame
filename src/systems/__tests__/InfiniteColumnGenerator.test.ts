import { describe, it, expect } from 'vitest';
import { buildColumnEntries } from '../InfiniteColumnGenerator';

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
