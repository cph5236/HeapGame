import { describe, it, expect } from 'vitest';
import { applyRarity, RARITY_DEFS, PickupEffect } from '../pickupDefs';

const skateboard: PickupEffect = { speedMult: 1.15, jumpBonus: -50, extraAirJumps: 0 };

describe('applyRarity', () => {
  it('is the identity at Rare (1x)', () => {
    expect(applyRarity(skateboard, 'rare')).toEqual(skateboard);
  });

  it('grows the good lever and shrinks the bad lever at Mythic', () => {
    const m = applyRarity(skateboard, 'mythic'); // mult 2.0
    // good: speed delta +0.15 -> x2 = +0.30 -> 1.30
    expect(m.speedMult).toBeCloseTo(1.30, 5);
    // bad: jump -50 -> x(1/2) = -25
    expect(m.jumpBonus).toBeCloseTo(-25, 5);
  });

  it('shrinks the good lever and grows the bad lever at Common', () => {
    const c = applyRarity(skateboard, 'common'); // mult 0.75
    expect(c.speedMult).toBeCloseTo(1 + 0.15 * 0.75, 5); // 1.1125
    expect(c.jumpBonus).toBeCloseTo(-50 / 0.75, 5);      // -66.67
  });

  it('treats gravity/cooldown/wallSpeed below 1 as the beneficial direction', () => {
    // feather: gravityMult 0.92 (float = good) -> Mythic pushes further down
    const feather: PickupEffect = { speedMult: 1, jumpBonus: 0, extraAirJumps: 0, gravityMult: 0.92 };
    const m = applyRarity(feather, 'mythic');
    expect(m.gravityMult!).toBeCloseTo(1 + (0.92 - 1) * 2, 5); // 0.84
  });

  it('reduces a harmful gravity penalty toward neutral at Mythic', () => {
    // concrete-boots: gravityMult 1.25 (heavy = bad)
    const boots: PickupEffect = { speedMult: 1, jumpBonus: 0, extraAirJumps: 0, gravityMult: 1.25 };
    const m = applyRarity(boots, 'mythic');
    expect(m.gravityMult!).toBeCloseTo(1 + 0.25 / 2, 5); // 1.125
  });

  it('never scales extraAirJumps (discrete capability)', () => {
    const balloon: PickupEffect = { speedMult: 1, jumpBonus: 0, extraAirJumps: 1 };
    expect(applyRarity(balloon, 'mythic').extraAirJumps).toBe(1);
    expect(applyRarity(balloon, 'common').extraAirJumps).toBe(1);
  });

  it('leaves undefined optional levers undefined', () => {
    const r = applyRarity(skateboard, 'mythic');
    expect(r.gravityMult).toBeUndefined();
    expect(r.cooldownMult).toBeUndefined();
    expect(r.wallSpeedMult).toBeUndefined();
  });

  it('clamps multiplicative levers to a small positive floor', () => {
    // engine-block at Common makes speed slower; ensure it never goes <= 0
    const block: PickupEffect = { speedMult: 0.75, jumpBonus: 0, extraAirJumps: 0 };
    const c = applyRarity(block, 'common');
    expect(c.speedMult).toBeGreaterThan(0);
  });
});

describe('RARITY_DEFS', () => {
  it('has an entry for every tier with a positive spawn weight', () => {
    for (const r of ['common', 'uncommon', 'rare', 'legendary', 'mythic'] as const) {
      expect(RARITY_DEFS[r].spawnWeight).toBeGreaterThan(0);
      expect(typeof RARITY_DEFS[r].color).toBe('number');
      expect(RARITY_DEFS[r].label.length).toBeGreaterThan(0);
    }
  });
});
