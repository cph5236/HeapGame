import { describe, it, expect, vi, beforeEach } from 'vitest';

const event = vi.fn();
vi.mock('../../logging', () => ({ getLogger: () => ({ event }) }));
vi.mock('../SaveData', () => ({ getUpgrades: () => ({ jump: 2 }) }));

import { emitRunEnd } from '../runEndEvent';

describe('emitRunEnd', () => {
  beforeEach(() => { event.mockClear(); });

  it('sums the kills map into a total', () => {
    emitRunEnd({
      heapId: 'h1', mode: 'normal', cause: 'death',
      score: 100, height: 50, durationMs: 1234,
      kills: { rat: 2, vulture: 3 },
      pickups: {}, pickupBonus: 0,
    });
    expect(event).toHaveBeenCalledTimes(1);
    expect(event.mock.calls[0][0]).toMatchObject({
      type: 'run:end', heapId: 'h1', mode: 'normal', cause: 'death',
      score: 100, height: 50, durationMs: 1234, kills: 5,
    });
  });

  it('reports zero kills for an empty map', () => {
    emitRunEnd({
      heapId: 'h1', mode: 'infinite', cause: 'quit',
      score: 0, height: 0, durationMs: 1, kills: {},
      pickups: {}, pickupBonus: 0,
    });
    expect(event.mock.calls[0][0].kills).toBe(0);
  });

  it('attaches the upgrades snapshot', () => {
    emitRunEnd({
      heapId: 'h1', mode: 'normal', cause: 'death',
      score: 1, height: 1, durationMs: 1, kills: {},
      pickups: {}, pickupBonus: 0,
    });
    expect(event.mock.calls[0][0].upgrades).toEqual({ jump: 2 });
  });

  it('passes the pickup tally straight through', () => {
    emitRunEnd({
      heapId: 'h1', mode: 'normal', cause: 'death',
      score: 1, height: 1, durationMs: 1, kills: {},
      pickups: { rust_bolt: 3 }, pickupBonus: 60,
    });
    expect(event.mock.calls[0][0]).toMatchObject({ pickups: { rust_bolt: 3 }, pickupBonus: 60 });
  });

  it('accepts cause "success" for a completed summit', () => {
    emitRunEnd({
      heapId: 'h1', mode: 'normal', cause: 'success',
      score: 1, height: 1, durationMs: 1, kills: {},
      pickups: {}, pickupBonus: 0,
    });
    expect(event.mock.calls[0][0]).toMatchObject({ cause: 'success' });
  });
});
