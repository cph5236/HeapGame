// server/tests/adminBandPlan.test.ts
//
// The fan-out rule. The client builds its polygon as [...base, ...liveVertices]
// and buckets to bands afterwards, so a band's rendered extent is the UNION of
// whatever both layers say. An edit that reaches only one layer therefore does
// not change what players see — the other layer's wider extent still wins.
// These tests pin that an edit reaches every layer holding the band.

import { describe, it, expect } from 'vitest';
import { planBandWrite } from '../src/game/routes/heap';
import { BAND_SIZE_PX } from '../../shared/heapPolygon/bandEnvelope';

const FREEZE_BAND = 100;
const FREEZE_Y = FREEZE_BAND * BAND_SIZE_PX;

describe('planBandWrite', () => {
  it('narrows a band held by BOTH layers in both of them', () => {
    const plan = planBandWrite({
      dirty:     [{ band: 50, minX: -100, maxX: 100 }],
      baseRows:  [{ band: 50, minX: -900, maxX: 900 }],
      liveBands: new Set([50]),
      freezeY:   FREEZE_Y,
    });
    expect(plan.liveRows).toEqual([{ band: 50, minX: -100, maxX: 100 }]);
    expect(plan.nextBaseRows).toEqual([{ band: 50, minX: -100, maxX: 100 }]);
  });

  it('leaves untouched base bands in the rebuilt base, ascending', () => {
    const plan = planBandWrite({
      dirty:     [{ band: 50, minX: -100, maxX: 100 }],
      baseRows:  [{ band: 60, minX: -5, maxX: 5 }, { band: 50, minX: -900, maxX: 900 }],
      liveBands: new Set(),
      freezeY:   FREEZE_Y,
    });
    expect(plan.nextBaseRows).toEqual([
      { band: 50, minX: -100, maxX: 100 },
      { band: 60, minX: -5,   maxX: 5 },
    ]);
    expect(plan.liveRows).toEqual([]);
  });

  it('writes only a live row when only the live layer holds the band', () => {
    const plan = planBandWrite({
      dirty:     [{ band: 50, minX: -100, maxX: 100 }],
      baseRows:  [{ band: 60, minX: -5, maxX: 5 }],
      liveBands: new Set([50]),
      freezeY:   FREEZE_Y,
    });
    expect(plan.liveRows).toEqual([{ band: 50, minX: -100, maxX: 100 }]);
    expect(plan.nextBaseRows).toEqual([{ band: 60, minX: -5, maxX: 5 }]);
  });

  it('creates a band held by neither layer in the LIVE layer above the freeze line', () => {
    const plan = planBandWrite({
      dirty:     [{ band: FREEZE_BAND - 1, minX: -10, maxX: 10 }],
      baseRows:  [],
      liveBands: new Set(),
      freezeY:   FREEZE_Y,
    });
    expect(plan.liveRows).toEqual([{ band: FREEZE_BAND - 1, minX: -10, maxX: 10 }]);
    expect(plan.nextBaseRows).toEqual([]);
  });

  it('creates a band held by neither layer in the BASE at or below the freeze line', () => {
    const plan = planBandWrite({
      dirty:     [{ band: FREEZE_BAND + 1, minX: -10, maxX: 10 }],
      baseRows:  [],
      liveBands: new Set(),
      freezeY:   FREEZE_Y,
    });
    expect(plan.liveRows).toEqual([]);
    expect(plan.nextBaseRows).toEqual([{ band: FREEZE_BAND + 1, minX: -10, maxX: 10 }]);
  });

  it('treats freezeY 0 as "nothing frozen" — a new band goes live', () => {
    // liveBandsOf reads freeze_y === 0 as the "nothing frozen yet" sentinel, so
    // every band is live on a never-frozen heap. Rule 3 must agree with it.
    const plan = planBandWrite({
      dirty:     [{ band: 9999, minX: -10, maxX: 10 }],
      baseRows:  [],
      liveBands: new Set(),
      freezeY:   0,
    });
    expect(plan.liveRows).toEqual([{ band: 9999, minX: -10, maxX: 10 }]);
    expect(plan.nextBaseRows).toEqual([]);
  });

  it('handles a freezeY-0 heap where both layers overlap — migration 0004 shape', () => {
    // 0004 backfilled heap_band from the live zone AND the base, so these heaps
    // have full overlap. Both layers must narrow or the union keeps the spike.
    const plan = planBandWrite({
      dirty:     [{ band: 7, minX: -50, maxX: 50 }],
      baseRows:  [{ band: 7, minX: -800, maxX: 800 }],
      liveBands: new Set([7]),
      freezeY:   0,
    });
    expect(plan.liveRows).toEqual([{ band: 7, minX: -50, maxX: 50 }]);
    expect(plan.nextBaseRows).toEqual([{ band: 7, minX: -50, maxX: 50 }]);
  });
});
