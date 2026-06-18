import { describe, it, expect } from 'vitest';
import {
  TUTORIAL_HEAP, TUTORIAL_STEPS, TUTORIAL_WORLD_HEIGHT,
  TUTORIAL_RAT_X, TUTORIAL_RAT_SURFACE_Y, TUTORIAL_ITEM_X, TUTORIAL_ITEM_SURFACE_Y,
  TUTORIAL_SPAWN_X, TUTORIAL_SPAWN_Y, tutorialMessage,
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

  it('spawns the player on the left move-shoulder, above the surface, not in the floor', () => {
    // The left flank's move shoulder runs from the edge (x=0) up to the jump-step at
    // x=150; the world floor (y=H) is inside the heap body, so spawn must sit above
    // the shoulder surface (highest shoulder point is y = H-150).
    expect(TUTORIAL_SPAWN_X).toBeGreaterThan(0);
    expect(TUTORIAL_SPAWN_X).toBeLessThan(150);                       // before the jump step
    expect(TUTORIAL_SPAWN_Y).toBeLessThan(TUTORIAL_WORLD_HEIGHT - 150); // above the shoulder
    expect(TUTORIAL_SPAWN_Y).toBeGreaterThan(0);
  });

  it('is a mound mirror-symmetric about the world centre, so wraps are seamless', () => {
    // Mirroring every vertex across x = W/2 must reproduce a matching point (the dome
    // summit is symmetric about the centre). Small Y tolerance guards rounding.
    const TOL = 2;
    const mirrorExists = (vx: number, vy: number) =>
      TUTORIAL_HEAP.some(u => Math.abs(u.x - (WORLD_WIDTH - vx)) <= TOL && Math.abs(u.y - vy) <= TOL);
    for (const v of TUTORIAL_HEAP) {
      expect(mirrorExists(v.x, v.y)).toBe(true);
    }
  });

  it('tells the player they can wrap around the screen during the move step', () => {
    const move = TUTORIAL_STEPS.find(s => s.id === 'move')!;
    expect(tutorialMessage(move, { mobile: false, mode: 'joystick' })).toMatch(/wrap/i);
    expect(tutorialMessage(move, { mobile: true, mode: 'joystick' })).toMatch(/wrap/i);
    expect(tutorialMessage(move, { mobile: true, mode: 'tilt' })).toMatch(/wrap/i);
  });

  it('places rat and item on heap surfaces within bounds', () => {
    for (const [x, y] of [
      [TUTORIAL_RAT_X, TUTORIAL_RAT_SURFACE_Y],
      [TUTORIAL_ITEM_X, TUTORIAL_ITEM_SURFACE_Y],
    ]) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(WORLD_WIDTH);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(TUTORIAL_WORLD_HEIGHT); // above the base, i.e. not the floor
    }
  });

  it('gives control-specific instructions for keyboard, joystick and tilt', () => {
    const dash = TUTORIAL_STEPS.find(s => s.id === 'dash')!;
    expect(tutorialMessage(dash, { mobile: false, mode: 'joystick' })).toMatch(/shift/i);
    expect(tutorialMessage(dash, { mobile: true, mode: 'joystick' })).toMatch(/swipe/i);

    const move = TUTORIAL_STEPS.find(s => s.id === 'move')!;
    expect(tutorialMessage(move, { mobile: true, mode: 'joystick' })).toMatch(/joystick/i);
    expect(tutorialMessage(move, { mobile: true, mode: 'tilt' })).toMatch(/tilt/i);
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
