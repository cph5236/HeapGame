import { describe, it, expect } from 'vitest';
import { PICKUP_DEFS, aggregateModifiers, PickupDef } from '../pickupDefs';

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
      speedMult: 1, jumpBonus: 0, extraAirJumps: 0, totalBonus: 0,
    });
  });

  it('returns a single item unchanged', () => {
    const d = def({ effect: { speedMult: 1.25, jumpBonus: 120, extraAirJumps: 1 }, scoreBonus: 250 });
    expect(aggregateModifiers([d])).toEqual({
      speedMult: 1.25, jumpBonus: 120, extraAirJumps: 1, totalBonus: 250,
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
});

describe('PICKUP_DEFS', () => {
  it('has unique ids and every def is fully formed', () => {
    expect(PICKUP_DEFS.length).toBeGreaterThan(0);
    const ids = PICKUP_DEFS.map(d => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of PICKUP_DEFS) {
      expect(d.name).toBeTruthy();
      expect(typeof d.effect.speedMult).toBe('number');
      expect(d.scoreBonus).toBeGreaterThan(0);
      expect(['positive', 'negative']).toContain(d.polarity);
    }
  });

  it('has at least one item of each polarity (pools non-empty)', () => {
    expect(PICKUP_DEFS.some(d => d.polarity === 'positive')).toBe(true);
    expect(PICKUP_DEFS.some(d => d.polarity === 'negative')).toBe(true);
  });
});
