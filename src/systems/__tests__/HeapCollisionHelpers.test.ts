import { describe, it, expect, vi } from 'vitest';
import { snapPlayerToSurface, depenetratePlayerFromWall } from '../HeapCollisionHelpers';
import { WALL_DEPENETRATION_FACTOR } from '../../constants';

// Player sprite mock for depenetration: body has left/right/x/velocity; sprite.x mirrors body.
function makeEmbeddablePlayer(opts: { x: number; halfWidth: number; vx?: number }) {
  const body = {
    x: opts.x - opts.halfWidth, // body top-left x
    get left() { return this.x; },
    get right() { return this.x + opts.halfWidth * 2; },
    velocity: { x: opts.vx ?? 0, y: 0 },
  };
  return { x: opts.x, body } as any;
}

function makeWall(side: 'left' | 'right' | null, left: number, right: number) {
  return {
    getData: (k: string) => (k === 'wallSide' ? side : undefined),
    body: { x: left, left, right },
  } as any;
}

// Helpers
function makePlayer(opts: { y?: number; x?: number; blockedDown?: boolean } = {}) {
  return {
    sprite: {
      x: opts.x ?? 0,
      y: opts.y ?? 100,
      body: { blocked: { down: opts.blockedDown ?? true } },
    },
  };
}

function makeCollider(slabTopAtX: number | null) {
  return { getSurfaceYAtX: vi.fn(() => slabTopAtX) } as any;
}

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

describe('depenetratePlayerFromWall', () => {
  it("pushes the player left out of a 'left' wall they've sunk into, zeroing rightward velocity", () => {
    // Player half-width 20, center x=100 → body left=80, right=120. Left wall at [110,130].
    // Overlap = right(120) - wall.left(110) = 10 → push left by 10 * factor.
    const player = makeEmbeddablePlayer({ x: 100, halfWidth: 20, vx: 50 });
    depenetratePlayerFromWall(player, makeWall('left', 110, 130));
    expect(player.x).toBeCloseTo(100 - 10 * WALL_DEPENETRATION_FACTOR, 5);
    expect(player.body.velocity.x).toBe(0); // into-wall (rightward) velocity killed
  });

  it("pushes the player right out of a 'right' wall, zeroing leftward velocity", () => {
    // body left=80, right=120. Right wall at [90,110]. Overlap = wall.right(110) - left(80) = 30.
    const player = makeEmbeddablePlayer({ x: 100, halfWidth: 20, vx: -50 });
    depenetratePlayerFromWall(player, makeWall('right', 90, 110));
    expect(player.x).toBeCloseTo(100 + 30 * WALL_DEPENETRATION_FACTOR, 5);
    expect(player.body.velocity.x).toBe(0);
  });

  it('does nothing when there is no horizontal overlap', () => {
    // body right=120, wall.left=130 → overlap negative → no push.
    const player = makeEmbeddablePlayer({ x: 100, halfWidth: 20, vx: 50 });
    depenetratePlayerFromWall(player, makeWall('left', 130, 150));
    expect(player.x).toBe(100);
    expect(player.body.velocity.x).toBe(50); // untouched
  });

  it('does not reverse velocity already moving out of the wall', () => {
    // 'left' wall, player already moving left (out) → keep their velocity.
    const player = makeEmbeddablePlayer({ x: 100, halfWidth: 20, vx: -30 });
    depenetratePlayerFromWall(player, makeWall('left', 110, 130));
    expect(player.x).toBeCloseTo(100 - 10 * WALL_DEPENETRATION_FACTOR, 5);
    expect(player.body.velocity.x).toBe(-30);
  });

  it('ignores walls with no wallSide data', () => {
    const player = makeEmbeddablePlayer({ x: 100, halfWidth: 20, vx: 50 });
    depenetratePlayerFromWall(player, makeWall(null, 110, 130));
    expect(player.x).toBe(100);
  });
});
