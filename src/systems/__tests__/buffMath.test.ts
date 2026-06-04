import { describe, it, expect } from 'vitest';
import { aggregateBuffEffects, upsertBuff, tickBuffs, ActiveBuff } from '../buffMath';

describe('aggregateBuffEffects', () => {
  it('returns identity for an empty list', () => {
    expect(aggregateBuffEffects([])).toEqual({
      speedMult: 1, jumpBonus: 0, extraAirJumps: 0,
      gravityMult: 1, cooldownMult: 1, wallSpeedMult: 1,
    });
  });

  it('multiplies multiplicative levers and adds additive ones', () => {
    const agg = aggregateBuffEffects([
      { speedMult: 1.3, jumpBonus: 75 },
      { speedMult: 1.1, wallSpeedMult: 0.25, jumpBonus: 10 },
    ]);
    expect(agg.speedMult).toBeCloseTo(1.43);
    expect(agg.jumpBonus).toBe(85);
    expect(agg.wallSpeedMult).toBe(0.25);
    expect(agg.gravityMult).toBe(1);
  });
});

describe('upsertBuff', () => {
  const mk = (id: string, remainingMs: number): ActiveBuff =>
    ({ id, effect: { speedMult: 1.3 }, remainingMs, durationMs: 30_000 });

  it('appends a new buff', () => {
    const out = upsertBuff([], mk('adrenaline', 30_000));
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('adrenaline');
  });

  it('refreshes (replaces) an existing buff by id without duplicating', () => {
    const out = upsertBuff([mk('adrenaline', 2_000)], mk('adrenaline', 30_000));
    expect(out).toHaveLength(1);
    expect(out[0].remainingMs).toBe(30_000);
  });
});

describe('tickBuffs', () => {
  const mk = (id: string, remainingMs: number): ActiveBuff =>
    ({ id, effect: {}, remainingMs, durationMs: 30_000 });

  it('decrements remaining time without dropping when still active', () => {
    const { active, changed } = tickBuffs([mk('a', 1_000)], 16);
    expect(active[0].remainingMs).toBe(984);
    expect(changed).toBe(false);
  });

  it('drops an expired buff and flags changed', () => {
    const { active, changed } = tickBuffs([mk('a', 10)], 16);
    expect(active).toHaveLength(0);
    expect(changed).toBe(true);
  });

  it('never expires a whole-run buff (Infinity)', () => {
    const { active, changed } = tickBuffs([mk('a', Infinity)], 16);
    expect(active[0].remainingMs).toBe(Infinity);
    expect(changed).toBe(false);
  });
});
