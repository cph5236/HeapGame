import { describe, it, expect } from 'vitest';
import { regenStamina, canSpend, spend } from '../stamina';
import { STAMINA_REGEN_GROUND_MS, STAMINA_REGEN_AIR_MS } from '../../constants';

describe('regenStamina', () => {
  it('regenerates one bar per STAMINA_REGEN_GROUND_MS while grounded', () => {
    expect(regenStamina(0, 3, STAMINA_REGEN_GROUND_MS, true, STAMINA_REGEN_AIR_MS)).toBeCloseTo(1);
  });

  it('regenerates one bar per airRegenMs while airborne', () => {
    expect(regenStamina(0, 3, STAMINA_REGEN_AIR_MS, false, STAMINA_REGEN_AIR_MS)).toBeCloseTo(1);
  });

  it('accumulates partial progress across frames rather than losing it', () => {
    // Three 16ms grounded frames = 48/200 of a bar. A per-bar timer that reset
    // each frame would return 0 here; the float accumulator must not.
    let s = 0;
    for (let i = 0; i < 3; i++) s = regenStamina(s, 3, 16, true, STAMINA_REGEN_AIR_MS);
    expect(s).toBeCloseTo(48 / STAMINA_REGEN_GROUND_MS);
  });

  it('clamps at max', () => {
    expect(regenStamina(2.9, 3, 10_000, true, STAMINA_REGEN_AIR_MS)).toBe(3);
  });

  it('honours a faster airborne regen rate from upgrades', () => {
    expect(regenStamina(0, 3, 1800, false, 1800)).toBeCloseTo(1);
  });

  it('never returns below zero', () => {
    expect(regenStamina(-5, 3, 0, false, STAMINA_REGEN_AIR_MS)).toBe(0);
  });
});

describe('canSpend / spend', () => {
  it('allows a spend the player can exactly afford', () => {
    expect(canSpend(1, 1)).toBe(true);
  });

  it('rejects a spend on a partial bar', () => {
    // 0.9 of a bar cannot buy a 1-cost action. This is the rule that makes
    // grounded regen a duration rather than a toggle.
    expect(canSpend(0.9, 1)).toBe(false);
  });

  it('subtracts the cost and floors at zero', () => {
    expect(spend(2.5, 1)).toBeCloseTo(1.5);
    expect(spend(0.4, 1)).toBe(0);
  });
});
