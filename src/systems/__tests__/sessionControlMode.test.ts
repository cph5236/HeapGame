import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  getControlMode,
  setControlMode,
  getEffectiveControlMode,
  setSessionControlMode,
  clearAutoControlOverride,
  resetCacheForTests,
} from '../SaveData';
import { startupControlOverride } from '../tiltAvailability';

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

  // Mirrors MenuScene's Settings → "Tilt" handler. Picking Tilt while permission
  // is still pending must leave a REVOCABLE joystick override: the player has
  // expressed a tilt preference, so the joystick is only standing in until the
  // hardware proves itself. Marking it non-auto would pin them for the session.
  it('Settings → Tilt while pending leaves an override that data can lift', () => {
    const pendingIos = {
      isMobile: true, requiresPermissionGesture: true,
      tiltPermissionGranted: false, tiltPermissionBlocked: false,
    };
    setControlMode('tilt');
    const override = startupControlOverride(pendingIos);
    setSessionControlMode(override, { auto: override !== null });
    expect(getEffectiveControlMode()).toBe('joystick');

    clearAutoControlOverride(); // first orientation reading arrives
    expect(getEffectiveControlMode()).toBe('tilt');
  });

  it('Settings → Tilt on an authorized device applies no override at all', () => {
    const android = {
      isMobile: true, requiresPermissionGesture: false,
      tiltPermissionGranted: true, tiltPermissionBlocked: false,
    };
    setControlMode('tilt');
    const override = startupControlOverride(android);
    setSessionControlMode(override, { auto: override !== null });
    expect(override).toBeNull();
    expect(getEffectiveControlMode()).toBe('tilt');
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
