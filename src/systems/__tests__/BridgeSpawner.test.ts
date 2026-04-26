import { describe, it, expect } from 'vitest';
import { shouldSpawnBridge } from '../BridgeSpawner';

const GROUND = 50000;

describe('shouldSpawnBridge', () => {
  it('returns true when both anchors are in band', () => {
    expect(shouldSpawnBridge(1200, 1250, 1000, 1500, GROUND)).toBe(true);
  });

  it('returns true for a steep diagonal when midpoint is in band', () => {
    expect(shouldSpawnBridge(1100, 1400, 1000, 1500, GROUND)).toBe(true);
  });

  it('returns false when left anchor is the ground fallback', () => {
    expect(shouldSpawnBridge(GROUND, 1200, 1000, 1500, GROUND)).toBe(false);
  });

  it('returns false when right anchor is the ground fallback', () => {
    expect(shouldSpawnBridge(1200, GROUND, 1000, 1500, GROUND)).toBe(false);
  });

  it('returns false when midpoint is above the band', () => {
    expect(shouldSpawnBridge(800, 820, 1000, 1500, GROUND)).toBe(false);
  });

  it('returns false when midpoint is below the band', () => {
    expect(shouldSpawnBridge(1600, 1620, 1000, 1500, GROUND)).toBe(false);
  });

  it('returns true at the exact band top boundary', () => {
    expect(shouldSpawnBridge(1000, 1000, 1000, 1500, GROUND)).toBe(true);
  });
});
