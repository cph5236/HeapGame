import { describe, it, expect } from 'vitest';
import { PICKUP_DEFS, aggregateModifiers, formatEffectSummary, PickupDef } from '../pickupDefs';

function def(over: Partial<PickupDef>): PickupDef {
  return {
    id:          'x',
    name:        'X',
    description: '',
    color:       0xffffff,
    polarity:    'positive',
    effect:      { speedMult: 1, jumpBonus: 0, extraAirJumps: 0 },
    scoreBonus:  0,
    ...over,
  };
}

describe('aggregateModifiers', () => {
  it('returns identity for an empty stack', () => {
    expect(aggregateModifiers([])).toEqual({
      speedMult: 1, jumpBonus: 0, extraAirJumps: 0,
      gravityMult: 1, cooldownMult: 1, wallSpeedMult: 1, totalBonus: 0,
    });
  });

  it('returns a single item unchanged', () => {
    const d = def({ effect: { speedMult: 1.25, jumpBonus: 120, extraAirJumps: 1 }, scoreBonus: 250 });
    expect(aggregateModifiers([d])).toEqual({
      speedMult: 1.25, jumpBonus: 120, extraAirJumps: 1,
      gravityMult: 1, cooldownMult: 1, wallSpeedMult: 1, totalBonus: 250,
    });
  });

  it('multiplies speed, sums jump/airjumps/bonus when stacking', () => {
    const a = def({ effect: { speedMult: 1.25, jumpBonus: 100, extraAirJumps: 0 }, scoreBonus: 250 });
    const b = def({ effect: { speedMult: 0.8,  jumpBonus: -40, extraAirJumps: 1 }, scoreBonus: 1800 });
    const agg = aggregateModifiers([a, b]);
    expect(agg.speedMult).toBeCloseTo(1.0);    // 1.25 * 0.8
    expect(agg.jumpBonus).toBe(60);            // 100 + (-40)
    expect(agg.extraAirJumps).toBe(1);
    expect(agg.totalBonus).toBe(2050);
  });

  it('composes gravity, cooldown, and wall-speed multipliers multiplicatively', () => {
    const a = def({ effect: { speedMult: 1, jumpBonus: 0, extraAirJumps: 0, gravityMult: 0.7, cooldownMult: 0.5 } });
    const b = def({ effect: { speedMult: 1, jumpBonus: 0, extraAirJumps: 0, gravityMult: 2.0, wallSpeedMult: 1.5 } });
    const agg = aggregateModifiers([a, b]);
    expect(agg.gravityMult).toBeCloseTo(1.4);   // 0.7 * 2.0
    expect(agg.cooldownMult).toBeCloseTo(0.5);  // 0.5 * 1 (b omits → 1)
    expect(agg.wallSpeedMult).toBeCloseTo(1.5); // 1 * 1.5
  });

  it('treats omitted multiplier levers as identity (1)', () => {
    const d = def({ effect: { speedMult: 1.2, jumpBonus: 0, extraAirJumps: 0 } });
    const agg = aggregateModifiers([d]);
    expect(agg.gravityMult).toBe(1);
    expect(agg.cooldownMult).toBe(1);
    expect(agg.wallSpeedMult).toBe(1);
  });
});

describe('formatEffectSummary', () => {
  const base = { speedMult: 1, jumpBonus: 0, extraAirJumps: 0 };

  it('formats speed as a signed percentage and jump as a signed number', () => {
    expect(formatEffectSummary({ speedMult: 1.15, jumpBonus: -50, extraAirJumps: 0 }))
      .toBe('+15% spd · -50 jump');
  });

  it('formats air jumps', () => {
    expect(formatEffectSummary({ ...base, extraAirJumps: 1 })).toBe('+1 air');
  });

  it('uses words for gravity / cooldown / wall levers', () => {
    expect(formatEffectSummary({ ...base, gravityMult: 0.85 })).toBe('float');
    expect(formatEffectSummary({ ...base, gravityMult: 1.3 })).toBe('heavy');
    expect(formatEffectSummary({ ...base, cooldownMult: 0.5 })).toBe('fast cd');
    expect(formatEffectSummary({ ...base, cooldownMult: 2 })).toBe('slow cd');
    expect(formatEffectSummary({ ...base, wallSpeedMult: 1.5 })).toBe('wall+');
    expect(formatEffectSummary({ ...base, wallSpeedMult: 0.7 })).toBe('wall-');
  });

  it('joins multiple levers in a fixed order', () => {
    expect(formatEffectSummary({ speedMult: 1.3, jumpBonus: 0, extraAirJumps: 0, wallSpeedMult: 1.3 }))
      .toBe('+30% spd · wall+');
  });

  it('returns empty string when there is no stat effect (e.g. the shield)', () => {
    expect(formatEffectSummary(base)).toBe('');
  });
});

describe('PICKUP_DEFS', () => {
  it('has unique ids and every def is fully formed', () => {
    expect(PICKUP_DEFS.length).toBeGreaterThan(0);
    const ids = PICKUP_DEFS.map(d => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of PICKUP_DEFS) {
      expect(d.name).toBeTruthy();
      expect(typeof d.effect.speedMult).toBe('number');
      expect(['positive', 'negative']).toContain(d.polarity);
      // Carry items award points; instant items (e.g. the free shield) award none.
      if (d.grantsShield) expect(d.scoreBonus).toBe(0);
      else                expect(d.scoreBonus).toBeGreaterThan(0);
    }
  });

  it('has at least one item of each polarity (pools non-empty)', () => {
    expect(PICKUP_DEFS.some(d => d.polarity === 'positive')).toBe(true);
    expect(PICKUP_DEFS.some(d => d.polarity === 'negative')).toBe(true);
  });
});
