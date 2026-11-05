import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  resolveReducedMotion, isReducedMotion, MIN_FLICKER_INTERVAL_MS,
  getReducedMotionChoice, setReducedMotionChoice,
} from '../accessibility';
import {
  resetAllData, getReduceMotionPref, mergeCloudSave, load, SAVE_KEY, resetCacheForTests,
  type RawSave,
} from '../SaveData';

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
  resetAllData();
});

describe('resolveReducedMotion', () => {
  it('follows the OS when the player has made no choice', () => {
    expect(resolveReducedMotion(undefined, true)).toBe(true);
    expect(resolveReducedMotion(undefined, false)).toBe(false);
  });

  it("lets the player's explicit choice override the OS either way", () => {
    expect(resolveReducedMotion(false, true)).toBe(false);
    expect(resolveReducedMotion(true, false)).toBe(true);
  });
});

describe('reduce-motion preference', () => {
  it('is unset on a fresh save, so the OS setting applies', () => {
    expect(getReduceMotionPref()).toBeUndefined();
    // No matchMedia in node: the OS reads as "no preference".
    expect(isReducedMotion()).toBe(false);
  });

  it('persists an explicit choice', () => {
    setReducedMotionChoice('on');
    resetCacheForTests();
    expect(getReduceMotionPref()).toBe(true);
    expect(getReducedMotionChoice()).toBe('on');
    expect(isReducedMotion()).toBe(true);
  });

  it("'auto' clears the override so the OS decides again", () => {
    setReducedMotionChoice('off');
    expect(getReducedMotionChoice()).toBe('off');
    setReducedMotionChoice('auto');
    resetCacheForTests();
    expect(getReduceMotionPref()).toBeUndefined();
    expect(getReducedMotionChoice()).toBe('auto');
  });

  it('survives migration of a current-schema save', () => {
    store[SAVE_KEY] = JSON.stringify({ ...load(), reduceMotion: true });
    resetCacheForTests();
    expect(getReduceMotionPref()).toBe(true);
  });

  it('is device-local on cloud merge: never taken from the cloud', () => {
    const base = load() as RawSave;
    expect(mergeCloudSave({ ...base, reduceMotion: false }, { ...base, reduceMotion: true }).reduceMotion)
      .toBe(false);
    // Unset locally means "follow this device's OS" — another device's explicit
    // Off must not override an OS that asks for reduced motion.
    expect(mergeCloudSave({ ...base, reduceMotion: undefined }, { ...base, reduceMotion: false }).reduceMotion)
      .toBeUndefined();
  });
});

describe('flicker limit', () => {
  it('keeps any repeating flicker at or under 3 flashes per second (WCAG 2.3.1)', () => {
    // A flash is two opposing transitions.
    expect(1000 / (2 * MIN_FLICKER_INTERVAL_MS)).toBeLessThanOrEqual(3);
  });
});

describe('reduceMotion migration', () => {
  it('drops a non-boolean value from a corrupt save', () => {
    store[SAVE_KEY] = JSON.stringify({ ...load(), reduceMotion: 'false' });
    resetCacheForTests();
    expect(getReduceMotionPref()).toBeUndefined();
  });
});
