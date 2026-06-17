import { describe, it, expect } from 'vitest';
import {
  entranceScale,
  ENTRANCE_FULL_SPAN_MS,
  ENTRANCE_FAST_SPAN_MS,
} from '../menuIntro';

describe('entranceScale', () => {
  it('runs the full-length cinematic on the first visit', () => {
    expect(entranceScale(true)).toBe(1);
  });

  it('compresses subsequent visits to the fast span', () => {
    expect(entranceScale(false)).toBeCloseTo(ENTRANCE_FAST_SPAN_MS / ENTRANCE_FULL_SPAN_MS);
  });

  it('keeps the fast span meaningfully shorter than the full span', () => {
    // A returning player waits noticeably less than the first-visit duration,
    // while still leaving enough room for the fade to feel graceful.
    expect(ENTRANCE_FAST_SPAN_MS).toBeLessThan(ENTRANCE_FULL_SPAN_MS / 2);
  });

  it('scales the longest first-visit delay into the fast window', () => {
    // The last element fades in at the full span; scaled, it must land by the fast span.
    expect(ENTRANCE_FULL_SPAN_MS * entranceScale(false)).toBeCloseTo(ENTRANCE_FAST_SPAN_MS);
  });
});
