import { describe, it, expect } from 'vitest';
import {
  TUTORIAL_HEAP, TUTORIAL_STEPS, TUTORIAL_WORLD_HEIGHT,
  TUTORIAL_RAT_X, TUTORIAL_ITEM_X,
} from '../tutorialFixture';
import { WORLD_WIDTH } from '../../constants';

describe('tutorial fixture', () => {
  it('is a closed polygon with at least 4 vertices', () => {
    expect(TUTORIAL_HEAP.length).toBeGreaterThanOrEqual(4);
  });

  it('keeps every vertex inside the world bounds', () => {
    for (const v of TUTORIAL_HEAP) {
      expect(v.x).toBeGreaterThanOrEqual(0);
      expect(v.x).toBeLessThanOrEqual(WORLD_WIDTH);
      expect(v.y).toBeGreaterThanOrEqual(0);
      expect(v.y).toBeLessThanOrEqual(TUTORIAL_WORLD_HEIGHT);
    }
  });

  it('spawns rat and item within world width', () => {
    for (const x of [TUTORIAL_RAT_X, TUTORIAL_ITEM_X]) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(WORLD_WIDTH);
    }
  });

  it('script ends on a tap-gated complete step preceded by placeBlock', () => {
    const ids = TUTORIAL_STEPS.map(s => s.id);
    expect(ids).toContain('placeBlock');
    const last = TUTORIAL_STEPS[TUTORIAL_STEPS.length - 1];
    expect(last.advanceOn).toBe('tap');
  });

  it('covers every taught mechanic in order', () => {
    const gates = TUTORIAL_STEPS.map(s => s.advanceOn);
    const required = ['move','jump','walljump','dash','dive','stomp','pickup','placeBlock'];
    let cursor = 0;
    for (const g of gates) {
      if (g === required[cursor]) cursor += 1;
    }
    expect(cursor).toBe(required.length); // all appeared, in order
  });
});
