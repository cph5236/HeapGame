import { describe, it, expect } from 'vitest';
import { clampVolume, volumeFromTrackX } from '../buildVolumePanel';

describe('clampVolume', () => {
  it('passes through values in [0,1]', () => {
    expect(clampVolume(0)).toBe(0);
    expect(clampVolume(0.5)).toBe(0.5);
    expect(clampVolume(1)).toBe(1);
  });
  it('clamps out-of-range values', () => {
    expect(clampVolume(-0.3)).toBe(0);
    expect(clampVolume(1.7)).toBe(1);
  });
});

describe('volumeFromTrackX', () => {
  const trackLeft = 100;
  const trackW = 220;
  it('maps the left edge to 0 and the right edge to 1', () => {
    expect(volumeFromTrackX(trackLeft, trackLeft, trackW)).toBe(0);
    expect(volumeFromTrackX(trackLeft + trackW, trackLeft, trackW)).toBe(1);
  });
  it('maps the midpoint to 0.5', () => {
    expect(volumeFromTrackX(trackLeft + trackW / 2, trackLeft, trackW)).toBeCloseTo(0.5, 5);
  });
  it('clamps pointers beyond the track ends', () => {
    expect(volumeFromTrackX(trackLeft - 50, trackLeft, trackW)).toBe(0);
    expect(volumeFromTrackX(trackLeft + trackW + 50, trackLeft, trackW)).toBe(1);
  });
});
