import { describe, it, expect } from 'vitest';
import { shouldSpawnBridge } from '../BridgeSpawner';

describe('shouldSpawnBridge', () => {
  it('returns true when surfaces match and are within band', () => {
    expect(shouldSpawnBridge(1200, 1250, 1000, 1500, 150)).toBe(true);
  });

  it('returns false when surface Y delta exceeds snap threshold', () => {
    expect(shouldSpawnBridge(1200, 1400, 1000, 1500, 150)).toBe(false);
  });

  it('returns false when both surfaces are above the band', () => {
    expect(shouldSpawnBridge(800, 820, 1000, 1500, 150)).toBe(false);
  });

  it('returns false when both surfaces are below the band', () => {
    expect(shouldSpawnBridge(1600, 1620, 1000, 1500, 150)).toBe(false);
  });

  it('returns true at the exact band boundary', () => {
    expect(shouldSpawnBridge(1000, 1050, 1000, 1500, 150)).toBe(true);
  });
});
