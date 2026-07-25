import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain JS module shared with the k6 runtime, no types
import { createBudget } from '../k6/lib/budget.js';

describe('createBudget', () => {
  it('starts unexceeded and allows placements', () => {
    const b = createBudget({ maxRequests: 10, maxPlacements: 2 });
    expect(b.exceeded()).toBe(false);
    expect(b.canPlace()).toBe(true);
  });

  it('reports exceeded once the request cap is reached', () => {
    const b = createBudget({ maxRequests: 3, maxPlacements: 10 });
    b.recordRequest(); b.recordRequest();
    expect(b.exceeded()).toBe(false);
    b.recordRequest();
    expect(b.exceeded()).toBe(true);
  });

  it('stops allowing placements at the placement cap', () => {
    const b = createBudget({ maxRequests: 100, maxPlacements: 2 });
    b.recordPlacement();
    expect(b.canPlace()).toBe(true);
    b.recordPlacement();
    expect(b.canPlace()).toBe(false);
  });

  it('placements do not consume the request budget twice', () => {
    const b = createBudget({ maxRequests: 100, maxPlacements: 10 });
    b.recordPlacement();
    expect(b.snapshot().placements).toBe(1);
    expect(b.snapshot().requests).toBe(0);
  });

  it('snapshot reports both counters', () => {
    const b = createBudget({ maxRequests: 100, maxPlacements: 10 });
    b.recordRequest(); b.recordRequest(); b.recordPlacement();
    expect(b.snapshot()).toEqual({ requests: 2, placements: 1, maxRequests: 100, maxPlacements: 10 });
  });
});
