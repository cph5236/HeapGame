import { describe, it, expect } from 'vitest';
import { bucketChoices, resolveWindow, previousWindow } from '../range';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-09-23T12:34:00Z');

describe('bucketChoices', () => {
  it('offers only buckets that give at least two points and stay under the server cap', () => {
    expect(bucketChoices(HOUR, NOW)).toEqual(['1m', '5m', '15m']);
    expect(bucketChoices(365 * DAY, NOW)).toEqual(['6h', '1d', '1w']);
  });
});

describe('resolveWindow', () => {
  it('resolves auto from the window length', () => {
    expect(resolveWindow({ preset: '24h', bucket: 'auto' }, NOW).bucket).toBe('15m');
    expect(resolveWindow({ preset: '1y', bucket: 'auto' }, NOW).bucket).toBe('1w');
  });

  it('honours a manual bucket that fits, and falls back to auto when it does not', () => {
    expect(resolveWindow({ preset: '30d', bucket: '1d' }, NOW).bucket).toBe('1d');
    expect(resolveWindow({ preset: '1y', bucket: '1m' }, NOW).bucket).toBe('1w');
  });

  it('previousWindow is the same length immediately before', () => {
    const w = resolveWindow({ preset: '7d', bucket: 'auto' }, NOW);
    const p = previousWindow(w);
    expect(p.untilMs).toBe(w.sinceMs);
    expect(p.untilMs - p.sinceMs).toBe(w.untilMs - w.sinceMs);
    expect(p.bucket).toBe(w.bucket);
  });
});
