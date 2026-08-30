import { describe, it, expect } from 'vitest';
import { checkFreezeBands, LIVE_ZONE_MAX_BANDS, FREEZE_BATCH_BANDS } from '../src/game/polygon';
import type { BandRow } from '../../shared/heapPolygon/bandEnvelope';

function bands(from: number, count: number): BandRow[] {
  return Array.from({ length: count }, (_, i) => ({ band: from + i, minX: 400, maxX: 500 }));
}

describe('checkFreezeBands', () => {
  it('preserves the live-zone span the vertex limits used to imply', () => {
    expect(LIVE_ZONE_MAX_BANDS).toBe(77);
    expect(FREEZE_BATCH_BANDS).toBe(38);
  });

  // Pre-freeze, freeze_y is 0 and callers pass Infinity — the "nothing is
  // frozen yet" sentinel. Passing bandOf(0) instead would name band 0 as the
  // freeze line and carve the live set out of the wrong side.
  it('does nothing below the band limit', () => {
    expect(checkFreezeBands(bands(2350, LIVE_ZONE_MAX_BANDS), Infinity)).toBeNull();
  });

  it('freezes the bottom batch once over the limit', () => {
    const res = checkFreezeBands(bands(2350, LIVE_ZONE_MAX_BANDS + 1), Infinity)!;
    expect(res.frozen).toHaveLength(FREEZE_BATCH_BANDS);
    // Bottom of the heap is the HIGHEST band (y grows downward).
    expect(res.frozen[0].band).toBe(2350 + LIVE_ZONE_MAX_BANDS + 1 - FREEZE_BATCH_BANDS);
    expect(res.newFreezeBand).toBe(res.frozen[0].band);
  });

  it('leaves the summit bands live', () => {
    const res = checkFreezeBands(bands(2350, LIVE_ZONE_MAX_BANDS + 1), Infinity)!;
    expect(res.frozen.every((b) => b.band >= res.newFreezeBand)).toBe(true);
    expect(res.frozen.some((b) => b.band === 2350)).toBe(false);
  });

  // The input is every band ever recorded — freeze deletes no rows — so past
  // freezes keep feeding bands back in. These two pin the live set to
  // `band < freezeBand`. Under the inverted filter the live set is the ~38
  // already-frozen bands, which can never exceed the limit, so freeze returns
  // null forever after the first one and the live zone grows unbounded.
  it('fires again once the live set above a past freeze line re-fills', () => {
    // Recorded: 2312..2427. A previous freeze put the line at 2390, so
    // live = 2312..2389 = 78 bands, one over the limit.
    const FIRST_FREEZE_BAND = 2390;
    const recorded = bands(2312, 116);
    const res = checkFreezeBands(recorded, FIRST_FREEZE_BAND);
    expect(res).not.toBeNull();
    expect(res!.frozen).toHaveLength(FREEZE_BATCH_BANDS);
    // The batch comes off the bottom of the LIVE set, not the bottom of the heap:
    // already-frozen bands are immutable and must never be re-frozen.
    expect(res!.frozen.every((b) => b.band < FIRST_FREEZE_BAND)).toBe(true);
    expect(res!.newFreezeBand).toBe(FIRST_FREEZE_BAND - FREEZE_BATCH_BANDS);
    // The line advances toward the summit; the frozen region only ever grows.
    expect(res!.newFreezeBand).toBeLessThan(FIRST_FREEZE_BAND);
    // Summit stays live.
    expect(res!.frozen.some((b) => b.band === 2312)).toBe(false);
  });

  it('stays quiet after a freeze while the live set is still within the limit', () => {
    // Same shape, one band fewer above the line: live = 2313..2389 = 77.
    expect(checkFreezeBands(bands(2313, 115), 2390)).toBeNull();
  });
});
