import { describe, it, expect } from 'vitest';
import { HEIGHT_ACHIEVEMENT_THRESHOLDS_PX } from '../achievementDefs';
import { SCORE_DISPLAY_DIVISOR } from '../../../shared/scoreConstants';
import { DEFAULT_HEAP_PARAMS } from '../../../shared/heapTypes';

describe('HEIGHT_ACHIEVEMENT_THRESHOLDS_PX', () => {
  // The HUD renders climb as feet via floor(px / SCORE_DISPLAY_DIVISOR), so a
  // threshold of N feet must equal N * SCORE_DISPLAY_DIVISOR raw px. This locks
  // the unlock point to the displayed number; if the divisor changes, these
  // thresholds move with it instead of silently drifting.
  it('expresses 100 ft / 1000 ft in raw px via the HUD divisor', () => {
    expect(HEIGHT_ACHIEVEMENT_THRESHOLDS_PX.reach_100m).toBe(100 * SCORE_DISPLAY_DIVISOR);
    expect(HEIGHT_ACHIEVEMENT_THRESHOLDS_PX.reach_1000m).toBe(1000 * SCORE_DISPLAY_DIVISOR);
  });

  // The original bug: thresholds (100_000 / 1_000_000 px) sat above the height a
  // player can physically climb on a default heap, so neither achievement could
  // ever unlock. Guard that both thresholds stay reachable.
  it('stays reachable within a default heap', () => {
    const maxClimbablePx = DEFAULT_HEAP_PARAMS.worldHeight; // floor (spawn) → summit (Y=0)
    expect(HEIGHT_ACHIEVEMENT_THRESHOLDS_PX.reach_100m).toBeLessThanOrEqual(maxClimbablePx);
    expect(HEIGHT_ACHIEVEMENT_THRESHOLDS_PX.reach_1000m).toBeLessThanOrEqual(maxClimbablePx);
  });

  it('orders the 1000 ft threshold above the 100 ft threshold', () => {
    expect(HEIGHT_ACHIEVEMENT_THRESHOLDS_PX.reach_1000m)
      .toBeGreaterThan(HEIGHT_ACHIEVEMENT_THRESHOLDS_PX.reach_100m);
  });
});
