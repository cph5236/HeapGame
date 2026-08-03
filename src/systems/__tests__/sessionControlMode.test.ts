import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  getControlMode,
  setControlMode,
  getEffectiveControlMode,
  setSessionControlMode,
  clearAutoControlOverride,
  resetCacheForTests,
} from '../SaveData';

// Stub localStorage — vitest runs in the node environment.
const store: Record<string, string> = {};
beforeAll(() => {
  Object.defineProperty(global, 'localStorage', {
    value: {
      getItem:    (k: string) => store[k] ?? null,
      setItem:    (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear:      () => { Object.keys(store).forEach(k => delete store[k]); },
    },
    configurable: true,
  });
});

beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
  resetCacheForTests();
});

describe('automatic vs explicit session control-mode override', () => {
  it('an automatic override masks the saved preference without overwriting it', () => {
    setControlMode('tilt');
    setSessionControlMode('joystick', { auto: true });
    expect(getEffectiveControlMode()).toBe('joystick');
    expect(getControlMode()).toBe('tilt'); // saved pref untouched
  });

  // The Chrome 151 case: the permission gate exists on Android but defaults to
  // ALLOW, so orientation data turns up moments after the precautionary override.
  // Tilt players must get their tilt back rather than being stuck on the joystick.
  it('clearAutoControlOverride restores the saved preference', () => {
    setControlMode('tilt');
    setSessionControlMode('joystick', { auto: true });
    clearAutoControlOverride();
    expect(getEffectiveControlMode()).toBe('tilt');
  });

  it('leaves an EXPLICIT joystick choice alone when data arrives late', () => {
    setControlMode('tilt');
    setSessionControlMode('joystick'); // player chose this in Settings / the prompt
    clearAutoControlOverride();
    expect(getEffectiveControlMode()).toBe('joystick');
  });

  it('an explicit choice made after an automatic one is no longer auto-revocable', () => {
    setSessionControlMode('joystick', { auto: true });
    setSessionControlMode('joystick'); // player confirms it explicitly
    clearAutoControlOverride();
    expect(getEffectiveControlMode()).toBe('joystick');
  });

  it('is a no-op when no override is active', () => {
    setControlMode('joystick');
    clearAutoControlOverride();
    expect(getEffectiveControlMode()).toBe('joystick');
  });

  it('clearing via setSessionControlMode(null) also drops the auto flag', () => {
    setControlMode('tilt');
    setSessionControlMode('joystick', { auto: true });
    setSessionControlMode(null);
    expect(getEffectiveControlMode()).toBe('tilt');
    clearAutoControlOverride();
    expect(getEffectiveControlMode()).toBe('tilt');
  });
});
