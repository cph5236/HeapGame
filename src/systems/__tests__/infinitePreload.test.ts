import { describe, it, expect } from 'vitest';
import { preloadProgress, preloadComplete } from '../infinitePreload';

describe('preloadProgress', () => {
  it('is 0 at the very start (nothing done, no time elapsed)', () => {
    expect(preloadProgress(0, 60, 0, 1000)).toBe(0);
  });

  it('is governed by the time ramp when generation finishes faster (the flash case)', () => {
    // All 60 bands built instantly, but only 250ms of a 1000ms minimum has passed.
    expect(preloadProgress(60, 60, 250, 1000)).toBeCloseTo(0.25);
  });

  it('is governed by real generation when it is the slower of the two', () => {
    // Half the bands built, but the 1000ms minimum is already past.
    expect(preloadProgress(30, 60, 1500, 1000)).toBeCloseTo(0.5);
  });

  it('reaches 1 only once both generation and the minimum duration are satisfied', () => {
    expect(preloadProgress(60, 60, 999, 1000)).toBeLessThan(1);
    expect(preloadProgress(60, 60, 1000, 1000)).toBe(1);
  });

  it('clamps above 1 (both well past their targets)', () => {
    expect(preloadProgress(120, 60, 5000, 1000)).toBe(1);
  });

  it('treats a zero band total as instantly generated (time-governed)', () => {
    expect(preloadProgress(0, 0, 500, 1000)).toBeCloseTo(0.5);
    expect(preloadProgress(0, 0, 1000, 1000)).toBe(1);
  });

  it('ignores the minimum when minMs is 0 (pure generation progress)', () => {
    expect(preloadProgress(15, 60, 0, 0)).toBeCloseTo(0.25);
  });
});

describe('preloadComplete', () => {
  it('is false while generation is still pending, even past the minimum', () => {
    expect(preloadComplete(true, 2000, 1000)).toBe(false);
  });

  it('is false when generation is done but the minimum has not elapsed', () => {
    expect(preloadComplete(false, 999, 1000)).toBe(false);
  });

  it('is true once generation is done and the minimum has elapsed', () => {
    expect(preloadComplete(false, 1000, 1000)).toBe(true);
  });

  it('completes as soon as generation is done when minMs is 0', () => {
    expect(preloadComplete(false, 0, 0)).toBe(true);
  });
});
