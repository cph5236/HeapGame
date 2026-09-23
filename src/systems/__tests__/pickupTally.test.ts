// src/systems/__tests__/pickupTally.test.ts

import { describe, it, expect } from 'vitest';
import { emptyTally, recordGrab } from '../pickupTally';

describe('pickupTally', () => {
  it('starts empty', () => {
    expect(emptyTally()).toEqual({ pickups: {}, pickupBonus: 0 });
  });

  it('counts a grab and sums the RARITY-SCALED bonus, not the base', () => {
    // mythic multiplier is 2.00 (shared/pickupScores.ts), so a base of 10 awards 20.
    const t = recordGrab(emptyTally(), 'rust_bolt', 10, 'mythic');
    expect(t).toEqual({ pickups: { rust_bolt: 1 }, pickupBonus: 20 });
  });

  it('rounds the scaled bonus the same way the award does', () => {
    // common multiplier is 0.75 -> 10 * 0.75 = 7.5 -> Math.round -> 8
    const t = recordGrab(emptyTally(), 'rust_bolt', 10, 'common');
    expect(t.pickupBonus).toBe(8);
  });

  it('accumulates repeat grabs of the same item id', () => {
    let t = emptyTally();
    t = recordGrab(t, 'rust_bolt', 10, 'rare');
    t = recordGrab(t, 'rust_bolt', 10, 'rare');
    expect(t.pickups).toEqual({ rust_bolt: 2 });
    expect(t.pickupBonus).toBe(20); // rare multiplier is 1.00
  });

  it('keeps distinct item ids separate', () => {
    let t = emptyTally();
    t = recordGrab(t, 'rust_bolt', 10, 'rare');
    t = recordGrab(t, 'cracked_lens', 4, 'rare');
    expect(t.pickups).toEqual({ rust_bolt: 1, cracked_lens: 1 });
    expect(t.pickupBonus).toBe(14);
  });

  it('does not mutate the tally it was given', () => {
    const before = emptyTally();
    const after = recordGrab(before, 'rust_bolt', 10, 'rare');
    expect(before).toEqual({ pickups: {}, pickupBonus: 0 });
    expect(after).not.toBe(before);
  });
});
