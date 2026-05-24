import { describe, it, expect, vi } from 'vitest';
import { handleWallCollision, snapPlayerToSurface, getWallSide } from '../HeapCollisionHelpers';

// Helpers
function makePlayer(opts: { y?: number; x?: number; blockedDown?: boolean; inSlopeZone?: boolean } = {}) {
  return {
    inSlopeZone:    opts.inSlopeZone ?? false,
    slopeEjectDir:  0,
    sprite: {
      x: opts.x ?? 0,
      y: opts.y ?? 100,
      body: { blocked: { down: opts.blockedDown ?? true } },
    },
  };
}

function makePlayerObj(blockedDown: boolean) {
  return { body: { blocked: { down: blockedDown } } } as any;
}

function makeWallObj(side: 'left' | 'right' | null) {
  return {
    getData: vi.fn((k: string) => k === 'wallSide' ? side : undefined),
  } as any;
}

function makeCollider(slabTopAtX: number | null) {
  return { getSurfaceYAtX: vi.fn(() => slabTopAtX) } as any;
}

describe('getWallSide', () => {
  it("returns 'left' when getData('wallSide') is 'left'", () => {
    expect(getWallSide(makeWallObj('left'))).toBe('left');
  });
  it("returns 'right' when getData('wallSide') is 'right'", () => {
    expect(getWallSide(makeWallObj('right'))).toBe('right');
  });
  it('returns null when wallSide data is missing', () => {
    expect(getWallSide(makeWallObj(null))).toBeNull();
  });
});

describe('handleWallCollision', () => {
  it("sets inSlopeZone=true and slopeEjectDir=-1 when player is blocked.down on a 'left' wall", () => {
    const player = makePlayer();
    handleWallCollision(player, makePlayerObj(true), makeWallObj('left'));
    expect(player.inSlopeZone).toBe(true);
    expect(player.slopeEjectDir).toBe(-1);
  });
  it("sets inSlopeZone=true and slopeEjectDir=+1 on a 'right' wall", () => {
    const player = makePlayer();
    handleWallCollision(player, makePlayerObj(true), makeWallObj('right'));
    expect(player.inSlopeZone).toBe(true);
    expect(player.slopeEjectDir).toBe(1);
  });
  it('does nothing when body.blocked.down is false', () => {
    const player = makePlayer();
    handleWallCollision(player, makePlayerObj(false), makeWallObj('left'));
    expect(player.inSlopeZone).toBe(false);
    expect(player.slopeEjectDir).toBe(0);
  });
});

describe('snapPlayerToSurface', () => {
  // PLAYER_HEIGHT is 46 (from src/constants.ts). feetY = sprite.y + 23.
  // Helper signature: snapPlayerToSurface(player, edgeColliders[], snapTolerancePx)

  it('snaps player.sprite.y down to slabTop - PLAYER_HEIGHT/2 when within tolerance', () => {
    // Player at y=100, feetY=123. Collider returns slabTop=120. targetY = 120 - 23 = 97.
    // |97 - 100| = 3 ≤ tolerance(8) → snap.
    const player = makePlayer({ y: 100 });
    snapPlayerToSurface(player, [makeCollider(120)], 8);
    expect(player.sprite.y).toBe(97);
  });

  it('does NOT snap when targetY is outside tolerance', () => {
    // Collider returns slabTop=200 → targetY=177. |177-100|=77 > tolerance(8) → no snap.
    const player = makePlayer({ y: 100 });
    snapPlayerToSurface(player, [makeCollider(200)], 8);
    expect(player.sprite.y).toBe(100);
  });

  it('does NOT snap when body.blocked.down is false', () => {
    const player = makePlayer({ y: 100, blockedDown: false });
    snapPlayerToSurface(player, [makeCollider(120)], 8);
    expect(player.sprite.y).toBe(100);
  });

  it('does NOT snap when inSlopeZone is true', () => {
    const player = makePlayer({ y: 100, inSlopeZone: true });
    snapPlayerToSurface(player, [makeCollider(120)], 8);
    expect(player.sprite.y).toBe(100);
  });

  it('does NOT snap when no collider returns a slabTop', () => {
    const player = makePlayer({ y: 100 });
    snapPlayerToSurface(player, [makeCollider(null)], 8);
    expect(player.sprite.y).toBe(100);
  });

  it('picks the highest (smallest Y) slabTop across multiple colliders', () => {
    // c1 returns 120, c2 returns 110 → pick 110 → targetY = 110 - 23 = 87.
    // |87 - 100| = 13 > tolerance(8) → no snap.
    // Bump tolerance to 20: snap to 87.
    const player = makePlayer({ y: 100 });
    snapPlayerToSurface(player, [makeCollider(120), makeCollider(110)], 20);
    expect(player.sprite.y).toBe(87);
  });

  it('passes the correct playerX and feetY to getSurfaceYAtX', () => {
    const c = makeCollider(null);
    const player = makePlayer({ x: 250, y: 100 });
    snapPlayerToSurface(player, [c], 8);
    expect(c.getSurfaceYAtX).toHaveBeenCalledWith(250, 123); // feetY = 100 + 23
  });
});
