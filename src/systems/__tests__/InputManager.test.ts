import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Stub window and navigator before the module loads (constructor accesses both)
beforeEach(() => {
  vi.stubGlobal('window', {});
  vi.stubGlobal('navigator', { maxTouchPoints: 0 });
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('InputManager — placeHeld', () => {
  it('starts as false', async () => {
    const { InputManager } = await import('../InputManager');
    expect(InputManager.getInstance().placeHeld).toBe(false);
  });

  it('startPlace() sets placeHeld to true', async () => {
    const { InputManager } = await import('../InputManager');
    const im = InputManager.getInstance();
    im.startPlace();
    expect(im.placeHeld).toBe(true);
  });

  it('endPlace() resets placeHeld to false after startPlace', async () => {
    const { InputManager } = await import('../InputManager');
    const im = InputManager.getInstance();
    im.startPlace();
    im.endPlace();
    expect(im.placeHeld).toBe(false);
  });

  it('endPlace() is safe to call when not holding', async () => {
    const { InputManager } = await import('../InputManager');
    const im = InputManager.getInstance();
    im.endPlace();
    expect(im.placeHeld).toBe(false);
  });
});

// ── Mobile environment helper ─────────────────────────────────────────────────
// Returns a fresh InputManager wired up as a mobile device with tilt listener
// attached (no iOS permission gate).
async function makeMobileIM() {
  vi.stubGlobal('navigator', { maxTouchPoints: 1 });

  const listeners: Record<string, EventListener[]> = {};
  vi.stubGlobal('window', {
    addEventListener: (type: string, cb: EventListener) => {
      listeners[type] = listeners[type] ?? [];
      listeners[type].push(cb);
    },
  });
  vi.stubGlobal('DeviceOrientationEvent', {});

  const { InputManager } = await import('../InputManager');
  const im = InputManager.getInstance();

  const fire = (type: string, event: object) =>
    (listeners[type] ?? []).forEach((cb) => cb(event as Event));

  return { im, fire, listeners };
}

// ── Analog tilt ───────────────────────────────────────────────────────────────

describe('InputManager — analog tilt', () => {
  it('tiltFactor is 0 when gamma is within dead zone', async () => {
    const { im, fire } = await makeMobileIM();
    fire('deviceorientation', { gamma: 1 });
    im.update(16, false);
    expect(im.tiltFactor).toBe(0);
  });

  it('tiltFactor is 0 when gamma equals TILT_DEAD_ZONE_DEG (boundary)', async () => {
    const { im, fire } = await makeMobileIM();
    fire('deviceorientation', { gamma: 2 });
    im.update(16, false);
    // At exactly TILT_DEAD_ZONE_DEG, linear ramp gives 0 / (25-2) = 0
    expect(im.tiltFactor).toBeCloseTo(0, 5);
  });

  it('tiltFactor is +1 when gamma >= TILT_MAX_DEG', async () => {
    const { im, fire } = await makeMobileIM();
    fire('deviceorientation', { gamma: 30 });
    im.update(16, false);
    expect(im.tiltFactor).toBe(1);
  });

  it('tiltFactor is -1 when gamma <= -TILT_MAX_DEG', async () => {
    const { im, fire } = await makeMobileIM();
    fire('deviceorientation', { gamma: -30 });
    im.update(16, false);
    expect(im.tiltFactor).toBe(-1);
  });

  it('tiltFactor at 25% of ramp range gives more than 0.4 — power curve boosts small tilts', async () => {
    // gamma = 7.75 => 25% into [2, 25] => linear raw = 0.25
    // with power curve (exp < 1): tiltFactor should be well above 0.25
    const { im, fire } = await makeMobileIM();
    fire('deviceorientation', { gamma: 7.75 });
    im.update(16, false);
    expect(im.tiltFactor).toBeGreaterThan(0.4);
  });

  it('tiltFactor at 25% of ramp range (negative) gives less than -0.4', async () => {
    const { im, fire } = await makeMobileIM();
    fire('deviceorientation', { gamma: -7.75 });
    im.update(16, false);
    expect(im.tiltFactor).toBeLessThan(-0.4);
  });

  it('goRight is true when tiltFactor > 0.01', async () => {
    const { im, fire } = await makeMobileIM();
    fire('deviceorientation', { gamma: 13.5 });
    im.update(16, false);
    expect(im.goRight).toBe(true);
    expect(im.goLeft).toBe(false);
  });

  it('goLeft is true when tiltFactor < -0.01', async () => {
    const { im, fire } = await makeMobileIM();
    fire('deviceorientation', { gamma: -13.5 });
    im.update(16, false);
    expect(im.goLeft).toBe(true);
    expect(im.goRight).toBe(false);
  });

  it('goLeft and goRight are both false in the dead zone', async () => {
    const { im, fire } = await makeMobileIM();
    fire('deviceorientation', { gamma: 1 });
    im.update(16, false);
    expect(im.goLeft).toBe(false);
    expect(im.goRight).toBe(false);
  });
});

// ── Swipe classifier ──────────────────────────────────────────────────────────

describe('InputManager — swipe classifier', () => {
  it('horizontal swipe right sets dashJustFired and dashDir=1', async () => {
    const { im, fire } = await makeMobileIM();

    vi.spyOn(performance, 'now').mockReturnValueOnce(0); // for touchstart
    fire('touchstart', {
      touches: [{ clientX: 100, clientY: 300 }],
    });
    // fast horizontal swipe
    vi.spyOn(performance, 'now').mockReturnValue(100); // for touchend
    fire('touchend', {
      changedTouches: [{ clientX: 200, clientY: 305 }],
    });
    vi.restoreAllMocks();

    im.update(16, false);
    expect(im.dashJustFired).toBe(true);
    expect(im.dashDir).toBe(1);
  });

  it('horizontal swipe left sets dashJustFired and dashDir=-1', async () => {
    const { im, fire } = await makeMobileIM();

    vi.spyOn(performance, 'now').mockReturnValueOnce(0); // for touchstart
    fire('touchstart', {
      touches: [{ clientX: 200, clientY: 300 }],
    });
    vi.spyOn(performance, 'now').mockReturnValue(100); // for touchend
    fire('touchend', {
      changedTouches: [{ clientX: 100, clientY: 305 }],
    });
    vi.restoreAllMocks();

    im.update(16, false);
    expect(im.dashJustFired).toBe(true);
    expect(im.dashDir).toBe(-1);
  });

  it('swipe-down sets diveJustFired', async () => {
    const { im, fire } = await makeMobileIM();

    vi.spyOn(performance, 'now').mockReturnValueOnce(0); // for touchstart
    fire('touchstart', {
      touches: [{ clientX: 150, clientY: 100 }],
    });
    vi.spyOn(performance, 'now').mockReturnValue(100); // for touchend
    // dy > dx, dy >= SWIPE_MIN_DISTANCE_PX (60), dy positive = down
    fire('touchend', {
      changedTouches: [{ clientX: 152, clientY: 180 }],
    });
    vi.restoreAllMocks();

    im.update(16, false);
    expect(im.diveJustFired).toBe(true);
  });

  it('swipe-up sets jumpJustPressed', async () => {
    const { im, fire } = await makeMobileIM();

    vi.spyOn(performance, 'now').mockReturnValueOnce(0); // for touchstart
    fire('touchstart', {
      touches: [{ clientX: 150, clientY: 200 }],
    });
    vi.spyOn(performance, 'now').mockReturnValue(100); // for touchend
    // dy negative = up, ady >= 60, ady > adx
    fire('touchend', {
      changedTouches: [{ clientX: 152, clientY: 120 }],
    });
    vi.restoreAllMocks();

    im.update(16, false);
    expect(im.jumpJustPressed).toBe(true);
  });

  it('tap (short movement) sets jumpJustPressed', async () => {
    const { im, fire } = await makeMobileIM();

    fire('touchstart', {
      touches: [{ clientX: 150, clientY: 300 }],
    });
    vi.spyOn(performance, 'now').mockReturnValue(100);
    fire('touchend', {
      changedTouches: [{ clientX: 153, clientY: 302 }],
    });
    vi.restoreAllMocks();

    im.update(16, false);
    expect(im.jumpJustPressed).toBe(true);
  });

  it('slow swipe (beyond SWIPE_MAX_TIME_MS) falls through to tap', async () => {
    const { im, fire } = await makeMobileIM();

    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValueOnce(0);   // touchstart time

    fire('touchstart', {
      touches: [{ clientX: 100, clientY: 300 }],
    });

    nowSpy.mockReturnValue(1000); // 1000 ms later — beyond SWIPE_MAX_TIME_MS
    fire('touchend', {
      changedTouches: [{ clientX: 200, clientY: 305 }],
    });
    vi.restoreAllMocks();

    im.update(16, false);
    // Too slow to be a dash — falls through to tap → jump
    expect(im.dashJustFired).toBe(false);
    expect(im.jumpJustPressed).toBe(true);
  });
});

// ── Multi-touch robustness ─────────────────────────────────────────────────────

describe('InputManager — multi-touch', () => {
  it('a second touchstart while tracking is ignored — original swipe still classifies as jump', async () => {
    const { im, fire } = await makeMobileIM();

    vi.spyOn(performance, 'now').mockReturnValue(0);
    // Finger 1 starts swipe up
    fire('touchstart', { touches: [{ clientX: 100, clientY: 300 }] });

    // Finger 2 lands mid-swipe at a different position — should be ignored
    fire('touchstart', { touches: [{ clientX: 200, clientY: 100 }] });

    vi.spyOn(performance, 'now').mockReturnValue(100);
    // Finger 1 lifts: dy=-70 up from original origin → should be jump
    fire('touchend', { changedTouches: [{ clientX: 100, clientY: 230 }] });
    vi.restoreAllMocks();

    im.update(16, false);
    expect(im.jumpJustPressed).toBe(true);
    expect(im.diveJustFired).toBe(false);
  });

  it('a second touchstart while dragging is ignored — drag state preserved', async () => {
    const { im, fire } = await makeMobileIM();
    fire('touchstart', { touches: [{ clientX: 100, clientY: 300 }] });
    // Enter drag state
    fire('touchmove', { touches: [{ clientX: 101, clientY: 280 }] });
    expect((im as any).touchState).toBe('drag');

    // Second finger down — should not reset to tracking
    fire('touchstart', { touches: [{ clientX: 200, clientY: 200 }] });
    expect((im as any).touchState).toBe('drag');
  });

  it('touchend from a non-tracked finger (by identifier) is ignored — gesture stays active', async () => {
    const { im, fire } = await makeMobileIM();
    vi.spyOn(performance, 'now').mockReturnValue(0);

    // Finger 1 (id=1) starts swipe up
    fire('touchstart', { touches: [{ identifier: 1, clientX: 100, clientY: 200 }] });

    vi.spyOn(performance, 'now').mockReturnValue(100);
    // Finger 2 (id=2) lifts with a downward motion — should be ignored
    fire('touchend', { changedTouches: [{ identifier: 2, clientX: 100, clientY: 260 }] }); // dy=+60 → would be dive if processed

    // Gesture should still be active (finger 1 hasn't lifted yet)
    expect((im as any).touchState).not.toBe('idle');

    // Finger 1 (id=1) lifts with upward motion — should register as jump
    fire('touchend', { changedTouches: [{ identifier: 1, clientX: 100, clientY: 130 }] }); // dy=-70 → jump
    vi.restoreAllMocks();

    im.update(16, false);
    expect(im.jumpJustPressed).toBe(true);
    expect(im.diveJustFired).toBe(false);
  });

  it('a non-tracked touchmove (by identifier) does not affect drag state', async () => {
    const { im, fire } = await makeMobileIM();

    // Finger 1 (id=1) starts tracking
    fire('touchstart', { touches: [{ identifier: 1, clientX: 100, clientY: 300 }] });
    expect((im as any).touchState).toBe('tracking');

    // Finger 2 (id=2) moves 20px up — enough to trigger drag (ady=20 > DRAG_THRESHOLD_PX=15)
    // but should be ignored because identifier does not match the tracked finger
    fire('touchmove', { touches: [{ identifier: 2, clientX: 101, clientY: 280 }] });
    expect((im as any).touchState).toBe('tracking'); // must NOT have entered drag
  });
});

// ── Touch state machine — drag ────────────────────────────────────────────────

describe('InputManager — drag state machine', () => {
  it('vertical touchmove >= DRAG_THRESHOLD_PX commits to drag state', async () => {
    const { im, fire } = await makeMobileIM();

    fire('touchstart', {
      touches: [{ clientX: 150, clientY: 300 }],
    });
    // Move 20px down (> DRAG_THRESHOLD_PX=15) with ady > adx
    fire('touchmove', {
      touches: [{ clientX: 151, clientY: 320 }],
    });

    expect(im.dragDown).toBe(true);
    expect(im.dragUp).toBe(false);
  });

  it('drag up sets dragUp when currentTouchY < touchStartY - DRAG_THRESHOLD_PX', async () => {
    const { im, fire } = await makeMobileIM();

    fire('touchstart', {
      touches: [{ clientX: 150, clientY: 300 }],
    });
    fire('touchmove', {
      touches: [{ clientX: 151, clientY: 280 }],
    });

    expect(im.dragUp).toBe(true);
    expect(im.dragDown).toBe(false);
  });

  it('touchend after drag suppresses jump and dash', async () => {
    const { im, fire } = await makeMobileIM();

    fire('touchstart', {
      touches: [{ clientX: 150, clientY: 300 }],
    });
    fire('touchmove', {
      touches: [{ clientX: 151, clientY: 320 }],
    });
    vi.spyOn(performance, 'now').mockReturnValue(100);
    fire('touchend', {
      changedTouches: [{ clientX: 151, clientY: 320 }],
    });
    vi.restoreAllMocks();

    im.update(16, false);
    expect(im.jumpJustPressed).toBe(false);
    expect(im.dashJustFired).toBe(false);
  });

  it('touchend after drag clears dragUp and dragDown', async () => {
    const { im, fire } = await makeMobileIM();

    fire('touchstart', {
      touches: [{ clientX: 150, clientY: 300 }],
    });
    fire('touchmove', {
      touches: [{ clientX: 151, clientY: 320 }],
    });
    expect(im.dragDown).toBe(true);

    fire('touchend', {
      changedTouches: [{ clientX: 151, clientY: 320 }],
    });

    expect(im.dragDown).toBe(false);
    expect(im.dragUp).toBe(false);
  });

  it('small horizontal touchmove does not enter drag state', async () => {
    const { im, fire } = await makeMobileIM();

    fire('touchstart', {
      touches: [{ clientX: 150, clientY: 300 }],
    });
    // adx > ady, so not a vertical drag
    fire('touchmove', {
      touches: [{ clientX: 175, clientY: 302 }],
    });

    expect(im.dragDown).toBe(false);
    expect(im.dragUp).toBe(false);
  });

  it('vertical move below DRAG_THRESHOLD_PX does not commit to drag', async () => {
    const { im, fire } = await makeMobileIM();

    fire('touchstart', {
      touches: [{ clientX: 150, clientY: 300 }],
    });
    // ady=10 < DRAG_THRESHOLD_PX=15
    fire('touchmove', {
      touches: [{ clientX: 151, clientY: 310 }],
    });

    expect(im.dragDown).toBe(false);
    expect(im.dragUp).toBe(false);
  });

  it('touchcancel resets state to idle and clears drag flags', async () => {
    const { im, fire } = await makeMobileIM();

    fire('touchstart', {
      touches: [{ clientX: 150, clientY: 300 }],
    });
    fire('touchmove', {
      touches: [{ clientX: 151, clientY: 320 }],
    });
    expect(im.dragDown).toBe(true);

    fire('touchcancel', {});

    expect(im.dragDown).toBe(false);
    expect(im.dragUp).toBe(false);

    // Confirm next touchstart begins cleanly (no stale tracking state)
    vi.spyOn(performance, 'now').mockReturnValueOnce(0);
    fire('touchstart', {
      touches: [{ clientX: 200, clientY: 200 }],
    });
    vi.spyOn(performance, 'now').mockReturnValue(50);
    fire('touchend', {
      changedTouches: [{ clientX: 300, clientY: 205 }],
    });
    vi.restoreAllMocks();

    im.update(16, false);
    expect(im.dashJustFired).toBe(true);
  });

  it('spurious touchend when idle is ignored', async () => {
    const { im, fire } = await makeMobileIM();

    // No touchstart — fire touchend directly
    fire('touchend', {
      changedTouches: [{ clientX: 150, clientY: 300 }],
    });

    im.update(16, false);
    expect(im.jumpJustPressed).toBe(false);
    expect(im.dashJustFired).toBe(false);
  });
});

// ── pendingJumpVx ─────────────────────────────────────────────────────────────

describe('InputManager — pendingJumpVx', () => {
  it('is 0 for a straight-up swipe (dx=0)', async () => {
    const { im, fire } = await makeMobileIM();
    fire('touchstart', { touches: [{ clientX: 100, clientY: 300 }] });
    fire('touchend', { changedTouches: [{ clientX: 100, clientY: 230 }] }); // dy=-70, dx=0
    expect((im as any).pendingJumpVx).toBe(0);
  });

  it('is positive for a swipe up-right (ady > adx)', async () => {
    const { im, fire } = await makeMobileIM();
    fire('touchstart', { touches: [{ clientX: 100, clientY: 300 }] });
    // dx=30 right, dy=-70 up → ady=70 > adx=30, ady >= SWIPE_MIN_DISTANCE_PX(60)
    fire('touchend', { changedTouches: [{ clientX: 130, clientY: 230 }] });
    expect((im as any).pendingJumpVx).toBeGreaterThan(0);
  });

  it('is negative for a swipe up-left (ady > adx)', async () => {
    const { im, fire } = await makeMobileIM();
    fire('touchstart', { touches: [{ clientX: 100, clientY: 300 }] });
    // dx=-30 left, dy=-70 up → ady=70 > adx=30, ady >= SWIPE_MIN_DISTANCE_PX(60)
    fire('touchend', { changedTouches: [{ clientX: 70, clientY: 230 }] });
    expect((im as any).pendingJumpVx).toBeLessThan(0);
  });

  it('transfers to jumpVx and clears pendingJumpVx on update()', async () => {
    const { im, fire } = await makeMobileIM();
    fire('touchstart', { touches: [{ clientX: 100, clientY: 300 }] });
    // dx=30 right, dy=-70 up → qualifies as swipe-up (ady > adx, ady >= 60)
    fire('touchend', { changedTouches: [{ clientX: 130, clientY: 230 }] });
    // Before update: pendingJumpVx is set, jumpVx is still 0
    expect((im as any).pendingJumpVx).toBeGreaterThan(0);
    expect(im.jumpVx).toBe(0);
    im.update(16, false);
    // After update: jumpVx received the value, pendingJumpVx cleared
    expect(im.jumpVx).toBeGreaterThan(0);
    expect((im as any).pendingJumpVx).toBe(0);
  });

  it('is set from a fast flick that crossed the drag threshold', async () => {
    const { im, fire } = await makeMobileIM();
    fire('touchstart', { touches: [{ clientX: 100, clientY: 300 }] });
    // Move enough to enter drag state (ady > DRAG_THRESHOLD_PX=15)
    fire('touchmove', { touches: [{ clientX: 105, clientY: 280 }] });
    // Lift fast with enough travel (ady >= SWIPE_MIN_DISTANCE_PX=60, dx=15 right)
    fire('touchend', { changedTouches: [{ clientX: 115, clientY: 230 }] });
    expect((im as any).pendingJumpVx).toBeGreaterThan(0);
  });

  it('a short diagonal swipe (total magnitude ≥ SWIPE_MIN but ady < SWIPE_MIN) fires jump with Vx — not a tap', async () => {
    const { im, fire } = await makeMobileIM();
    // dx=15, dy=-27: ady=27 < SWIPE_MIN_DISTANCE_PX(30) but magnitude=√(225+729)≈30.9 ≥ 30
    // currently classified as tap (ady < 30 → fast=false) → jumpVx=0
    // should be jump with Vx (magnitude qualifies it as a real swipe)
    fire('touchstart', { touches: [{ clientX: 100, clientY: 300 }] });
    fire('touchend', { changedTouches: [{ clientX: 115, clientY: 273 }] });
    expect((im as any).pendingJumpVx).not.toBe(0);
  });

  it('a ~25° diagonal swipe gives more than 75% of max horizontal speed (power curve)', async () => {
    const { im, fire } = await makeMobileIM();
    const MAX = 400; // SWIPE_JUMP_HORIZONTAL_MAX
    fire('touchstart', { touches: [{ clientX: 100, clientY: 300 }] });
    // dx=40, dy=-86 → ~25° from vertical; ady=86 > adx=40, ady >= SWIPE_MIN_DISTANCE_PX(60)
    fire('touchend', { changedTouches: [{ clientX: 140, clientY: 214 }] });
    expect((im as any).pendingJumpVx).toBeGreaterThan(MAX * 0.75);
  });

  it('a ~44° diagonal swipe gives more than 95% of max horizontal speed (power curve)', async () => {
    const { im, fire } = await makeMobileIM();
    const MAX = 400; // SWIPE_JUMP_HORIZONTAL_MAX
    fire('touchstart', { touches: [{ clientX: 100, clientY: 300 }] });
    // dx=59, dy=-60 → ~44° from vertical; ady=60 > adx=59, ady=60 >= SWIPE_MIN_DISTANCE_PX(60)
    fire('touchend', { changedTouches: [{ clientX: 159, clientY: 240 }] });
    expect((im as any).pendingJumpVx).toBeGreaterThan(MAX * 0.95);
  });
});

// ── diveJustFired consumed per frame ─────────────────────────────────────────

describe('InputManager — diveJustFired lifecycle', () => {
  it('diveJustFired is false by default', async () => {
    const { im } = await makeMobileIM();
    expect(im.diveJustFired).toBe(false);
  });

  it('diveJustFired is cleared after the next update()', async () => {
    const { im, fire } = await makeMobileIM();

    fire('touchstart', {
      touches: [{ clientX: 150, clientY: 100 }],
    });
    vi.spyOn(performance, 'now').mockReturnValue(100);
    fire('touchend', {
      changedTouches: [{ clientX: 152, clientY: 180 }],
    });
    vi.restoreAllMocks();

    im.update(16, false); // first frame — diveJustFired should be true
    expect(im.diveJustFired).toBe(true);

    im.update(16, false); // second frame — should clear
    expect(im.diveJustFired).toBe(false);
  });
});
