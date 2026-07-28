import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

vi.mock('../../ConfigClient', () => ({
  getConfigValue: vi.fn(() => undefined),
}));
import { getConfigValue } from '../../ConfigClient';

import { rollTarget, decideAdRun, registerRun, AD_CADENCE_MIN, AD_CADENCE_MAX } from '../AdCadence';
import { getAdRunState, setAdRunState, resetCacheForTests } from '../../SaveData';

// Stub localStorage — vitest runs in node environment
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

describe('rollTarget', () => {
  it('returns AD_CADENCE_MIN when rand is 0', () => {
    expect(rollTarget(() => 0)).toBe(AD_CADENCE_MIN);
  });
  it('returns AD_CADENCE_MAX when rand approaches 1', () => {
    expect(rollTarget(() => 0.999)).toBe(AD_CADENCE_MAX);
  });
  it('stays within [MIN, MAX]', () => {
    for (let i = 0; i < 50; i++) {
      const t = rollTarget();
      expect(t).toBeGreaterThanOrEqual(AD_CADENCE_MIN);
      expect(t).toBeLessThanOrEqual(AD_CADENCE_MAX);
    }
  });
});

describe('decideAdRun', () => {
  it('does not fire before the target is reached', () => {
    const { next, isAdRun } = decideAdRun({ runsSinceLast: 0, target: 3 });
    expect(isAdRun).toBe(false);
    expect(next).toEqual({ runsSinceLast: 1, target: 3 });
  });

  it('fires and re-rolls when the counter reaches the target', () => {
    const { next, isAdRun } = decideAdRun({ runsSinceLast: 2, target: 3 }, () => 0);
    expect(isAdRun).toBe(true);
    expect(next).toEqual({ runsSinceLast: 0, target: AD_CADENCE_MIN }); // rand=0 -> MIN
  });

  it('never fires on run 1 even at the minimum target', () => {
    const { isAdRun } = decideAdRun({ runsSinceLast: 0, target: AD_CADENCE_MIN });
    expect(isAdRun).toBe(false);
  });
});

describe('registerRun', () => {
  it('returns false and does not mutate state when ads are disabled', () => {
    setAdRunState({ runsSinceLast: 1, target: 3 });
    expect(registerRun(false)).toBe(false);
    expect(getAdRunState()).toEqual({ runsSinceLast: 1, target: 3 });
  });

  it('seeds an unseeded target and increments when enabled', () => {
    expect(registerRun(true, () => 0)).toBe(false);          // seeds target=AD_CADENCE_MIN, runsSinceLast 0->1
    expect(getAdRunState()).toEqual({ runsSinceLast: 1, target: AD_CADENCE_MIN });
  });

  it('fires on the run that reaches the target', () => {
    // Target must sit inside the live range or it is treated as stale and redrawn.
    setAdRunState({ runsSinceLast: AD_CADENCE_MIN - 1, target: AD_CADENCE_MIN });
    expect(registerRun(true, () => 0)).toBe(true);           // 39->40 reaches target -> ad run
    expect(getAdRunState()).toEqual({ runsSinceLast: 0, target: AD_CADENCE_MIN });
  });
});

describe('rollTarget with remote config', () => {
  const mockGetConfigValue = vi.mocked(getConfigValue);

  beforeEach(() => { mockGetConfigValue.mockReset(); });

  it('uses the remote min/max when config is present', () => {
    mockGetConfigValue.mockReturnValue({ min: 5, max: 5 });
    expect(rollTarget(() => 0.5)).toBe(5);
  });

  it('falls back to AD_CADENCE_MIN/MAX when config is absent', () => {
    mockGetConfigValue.mockReturnValue(undefined);
    expect(rollTarget(() => 0)).toBe(AD_CADENCE_MIN);
    expect(rollTarget(() => 0.999)).toBe(AD_CADENCE_MAX);
  });
});

describe('registerRun re-rolls a stale target when the remote range moves', () => {
  const mockGetConfigValue = vi.mocked(getConfigValue);

  beforeEach(() => { mockGetConfigValue.mockReset(); });

  // The bug: a target drawn from the old hardcoded 40-50 range stayed stored
  // forever, so lowering ad_cadence to 1-3 in prod had no effect on an existing
  // install until the *next* ad fired — which needed ~45 more runs to happen.
  it('redraws a target that sits above the current range', () => {
    mockGetConfigValue.mockReturnValue({ min: 1, max: 3 });
    setAdRunState({ runsSinceLast: 0, target: 47 });   // stale, from the 40-50 era

    // rand=0.9 draws the top of 1-3, so the redraw is visible rather than firing at once.
    expect(registerRun(true, () => 0.9)).toBe(false);
    expect(getAdRunState()).toEqual({ runsSinceLast: 1, target: 3 });
  });

  it('redraws a target that sits below the current range', () => {
    mockGetConfigValue.mockReturnValue({ min: 40, max: 50 });
    setAdRunState({ runsSinceLast: 0, target: 2 });

    expect(registerRun(true, () => 0)).toBe(false);
    expect(getAdRunState()).toEqual({ runsSinceLast: 1, target: 40 });
  });

  it('fires immediately when the backlog already exceeds the redrawn target', () => {
    mockGetConfigValue.mockReturnValue({ min: 1, max: 3 });
    setAdRunState({ runsSinceLast: 20, target: 47 });  // 20 runs banked under the old range

    expect(registerRun(true, () => 0)).toBe(true);
    expect(getAdRunState()).toEqual({ runsSinceLast: 0, target: 1 });
  });

  it('leaves an in-range target alone so the cadence is not reset every run', () => {
    mockGetConfigValue.mockReturnValue({ min: 1, max: 3 });
    setAdRunState({ runsSinceLast: 0, target: 3 });

    expect(registerRun(true, () => 0)).toBe(false);
    expect(getAdRunState()).toEqual({ runsSinceLast: 1, target: 3 }); // still 3, not redrawn to 1
  });
});
