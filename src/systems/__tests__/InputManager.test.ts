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
