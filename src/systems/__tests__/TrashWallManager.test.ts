import { describe, it, expect } from 'vitest';
import { computeWallSpeed, clampWallY, isKillZoneReached } from '../TrashWallManager';

// World: Y=0 is summit, Y=50000 is floor (MOCK_HEAP_HEIGHT_PX = 50000)
const WORLD_H = 50_000;

describe('computeWallSpeed', () => {
  it('returns speedMin when wall is at world floor', () => {
    // wallY = WORLD_H, t = 1 → speed = speedMax - 1*(speedMax - speedMin) = speedMin
    expect(computeWallSpeed(50_000, 40, 120, 5_000, WORLD_H)).toBeCloseTo(40);
  });

  it('returns speedMax when wall is at yForMaxSpeed', () => {
    // wallY = yForMaxSpeed, t = 0 → speed = speedMax - 0 = speedMax
    expect(computeWallSpeed(5_000, 40, 120, 5_000, WORLD_H)).toBeCloseTo(120);
  });

  it('returns speedMax (clamped) when wall is above yForMaxSpeed', () => {
    // wallY < yForMaxSpeed → t clamped to 0 → speed = speedMax
    expect(computeWallSpeed(1_000, 40, 120, 5_000, WORLD_H)).toBeCloseTo(120);
  });

  it('returns interpolated speed at midpoint', () => {
    // wallY midpoint between yForMaxSpeed (5000) and floor (50000): 27500
    // t = (27500 - 5000) / (50000 - 5000) = 22500 / 45000 = 0.5
    // speed = 120 - 0.5 * (120 - 40) = 120 - 40 = 80
    expect(computeWallSpeed(27_500, 40, 120, 5_000, WORLD_H)).toBeCloseTo(80);
  });
});

describe('clampWallY', () => {
  it('returns wallY unchanged when wall is within maxLaggingDistance', () => {
    // wallY=2000, playerY=100, maxLag=2200 → playerY + maxLag = 2300 > wallY → no clamp
    expect(clampWallY(2000, 100, 2200)).toBe(2000);
  });

  it('clamps wallY to playerY + maxLaggingDistance when wall lags too far', () => {
    // wallY=3000, playerY=100, maxLag=2200 → playerY + maxLag = 2300 < wallY → clamp to 2300
    expect(clampWallY(3000, 100, 2200)).toBe(2300);
  });

  it('clamps exactly at the boundary', () => {
    expect(clampWallY(2300, 100, 2200)).toBe(2300);
  });
});

describe('isKillZoneReached', () => {
  it('returns false when player is above the kill zone', () => {
    // wallY=1000, killZoneHeight=30 → kill threshold = 1000 - 30 = 970
    // playerY=900 < 970 → not in kill zone
    expect(isKillZoneReached(900, 1000, 30)).toBe(false);
  });

  it('returns true when player Y equals kill threshold', () => {
    // playerY=970 >= 970 → kill zone reached
    expect(isKillZoneReached(970, 1000, 30)).toBe(true);
  });

  it('returns true when player is fully inside the wall', () => {
    expect(isKillZoneReached(1050, 1000, 30)).toBe(true);
  });
});
