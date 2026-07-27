import { describe, it, expect } from 'vitest';
import { checkFreezeBands, LIVE_ZONE_MAX_BANDS, FREEZE_BATCH_BANDS } from '../src/polygon';
import type { BandRow } from '../../shared/heapPolygon/bandEnvelope';

function bands(from: number, count: number): BandRow[] {
  return Array.from({ length: count }, (_, i) => ({ band: from + i, minX: 400, maxX: 500 }));
}

describe('checkFreezeBands', () => {
  it('preserves the live-zone span the vertex limits used to imply', () => {
    expect(LIVE_ZONE_MAX_BANDS).toBe(77);
    expect(FREEZE_BATCH_BANDS).toBe(38);
  });

  it('does nothing below the band limit', () => {
    expect(checkFreezeBands(bands(2350, LIVE_ZONE_MAX_BANDS), 2350)).toBeNull();
  });

  it('freezes the bottom batch once over the limit', () => {
    const res = checkFreezeBands(bands(2350, LIVE_ZONE_MAX_BANDS + 1), 2350)!;
    expect(res.frozen).toHaveLength(FREEZE_BATCH_BANDS);
    // Bottom of the heap is the HIGHEST band (y grows downward).
    expect(res.frozen[0].band).toBe(2350 + LIVE_ZONE_MAX_BANDS + 1 - FREEZE_BATCH_BANDS);
    expect(res.newFreezeBand).toBe(res.frozen[0].band);
  });

  it('leaves the summit bands live', () => {
    const res = checkFreezeBands(bands(2350, LIVE_ZONE_MAX_BANDS + 1), 2350)!;
    expect(res.frozen.every((b) => b.band >= res.newFreezeBand)).toBe(true);
    expect(res.frozen.some((b) => b.band === 2350)).toBe(false);
  });
});
