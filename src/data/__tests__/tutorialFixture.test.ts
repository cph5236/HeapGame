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
    // Mirroring every vertex across x = W/2 must reproduce a matching point (the flat
    // plateau summit is symmetric about the centre). Small Y tolerance guards rounding.
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

describe('tutorial step pacing', () => {
  // Regression: the stamina step originally used advanceOn 'jump' — the SAME
  // action as the `jump` step immediately before it. The player's next jump,
  // a second later mid-climb, dismissed it before it could be read, so it
  // looked like the step simply never appeared. Two consecutive steps must
  // never key on the same action.
  it('never advances two consecutive steps on the same action', () => {
    for (let i = 1; i < TUTORIAL_STEPS.length; i++) {
      const prev = TUTORIAL_STEPS[i - 1], cur = TUTORIAL_STEPS[i];
      if (prev.advanceOn === 'tap' || cur.advanceOn === 'tap') continue;
      expect(
        cur.advanceOn,
        `"${cur.id}" advances on the same action as "${prev.id}" ("${cur.advanceOn}"), `
        + 'so the input that clears the earlier step clears this one too',
      ).not.toBe(prev.advanceOn);
    }
  });

  it('teaches stamina as a dismissable popup, not a passing hint', () => {
    const stamina = TUTORIAL_STEPS.find(s => s.id === 'stamina');
    expect(stamina).toBeDefined();
    // 'info' freezes gameplay and shows the panel; 'tap' means only a
    // deliberate dismissal advances it.
    expect(stamina!.mode).toBe('info');
    expect(stamina!.advanceOn).toBe('tap');
  });

  it('explains stamina the same way in both control schemes', () => {
    const stamina = TUTORIAL_STEPS.find(s => s.id === 'stamina')!;
    const desktop = tutorialMessage(stamina, { mobile: false, mode: 'joystick' });
    const touch   = tutorialMessage(stamina, { mobile: true,  mode: 'joystick' });
    // The copy describes the resource, not the button, so it is shared verbatim.
    expect(desktop).toBe(touch);
    expect(desktop.toLowerCase()).toContain('stamina');
    expect(desktop).toMatch(/free/i);          // jumps/dives/wall slides cost nothing
  });
});
