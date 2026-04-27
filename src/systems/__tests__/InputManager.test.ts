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

  it('tiltFactor is proportional in the ramp range (positive)', async () => {
    const { im, fire } = await makeMobileIM();
    // gamma = 13.5 => midpoint of [2, 25] => factor = (13.5-2)/(25-2) = 0.5
    fire('deviceorientation', { gamma: 13.5 });
    im.update(16, false);
    expect(im.tiltFactor).toBeCloseTo(0.5, 5);
  });

  it('tiltFactor is proportional in the ramp range (negative)', async () => {
    const { im, fire } = await makeMobileIM();
    fire('deviceorientation', { gamma: -13.5 });
    im.update(16, false);
    expect(im.tiltFactor).toBeCloseTo(-0.5, 5);
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
