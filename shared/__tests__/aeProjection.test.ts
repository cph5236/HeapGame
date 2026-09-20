import { describe, it, expect } from 'vitest';
import { projectEventMetrics } from '../logging/aeProjection';

describe('projectEventMetrics', () => {
  it('projects run:end facts in the documented column order', () => {
    const out = projectEventMetrics({
      type: 'run:end', heapId: 'h1', mode: 'normal',
      score: 1200, height: 340, kills: 5, durationMs: 61000,
      cause: 'death', upgrades: {}, pickups: { rust_bolt: 2 }, pickupBonus: 40,
    });
    // double2..double6
    expect(out?.doubles).toEqual([1200, 340, 5, 61000, 40]);
    // blob8
    expect(out?.blobs).toEqual(['death']);
  });

  it('distinguishes quit from death in the cause column', () => {
    const out = projectEventMetrics({
      type: 'run:end', heapId: 'h1', mode: 'infinite',
      score: 0, height: 0, kills: 0, durationMs: 1,
      cause: 'quit', upgrades: {}, pickups: {}, pickupBonus: 0,
    });
    expect(out?.blobs).toEqual(['quit']);
  });

  it('projects nothing for events with no numeric facts', () => {
    expect(projectEventMetrics({ type: 'user:created' })).toBeUndefined();
    expect(projectEventMetrics({ type: 'run:start', heapId: 'h1', mode: 'normal' })).toBeUndefined();
  });
});
