import { describe, it, expect, vi } from 'vitest';
import { ScanlineRow } from '../HeapPolygon';
import { HeapEdgeCollider } from '../HeapEdgeCollider';

// Phaser StaticGroup mock — HeapEdgeCollider only calls group.create() + a few
// methods on the returned image object.
function makeMockImg() {
  return {
    setVisible:        vi.fn().mockReturnThis(),
    setDisplaySize:    vi.fn().mockReturnThis(),
    setDebugBodyColor: vi.fn().mockReturnThis(),
    setData:           vi.fn().mockReturnThis(),
    refreshBody:       vi.fn(),
    destroy:           vi.fn(),
    body: { checkCollision: { down: true } },
  };
}

function makeMockGroup() {
  return { create: vi.fn(() => makeMockImg()) };
}

// 3 rows where the left edge has a ~45° slope (deltaX = SCAN_STEP = 4 per row).
// 45° > default 35° threshold → normally a wall body.
// 45° < 60° custom threshold → walkable body.
// Right edge is vertical (90°) in all cases → always a wall body.
const rows45deg: ScanlineRow[] = [
  { y: 0, leftX: 100, rightX: 200 },
  { y: 4, leftX: 104, rightX: 200 },
  { y: 8, leftX: 108, rightX: 200 },
];

// ── getSurfaceYAtX ────────────────────────────────────────────────────────────
// FLOOR_BODY_HEIGHT = 8  →  slabTop = row.y - 4

describe('HeapEdgeCollider – getSurfaceYAtX', () => {
  it('returns the highest slab top (smallest Y) covering worldX', () => {
    const collider = new HeapEdgeCollider(null as any);
    collider.buildFromScanlines(0, [
      { y: 100, leftX: 50, rightX: 300 }, // slabTop = 96
      { y: 104, leftX: 50, rightX: 300 }, // slabTop = 100
    ], makeMockGroup() as any, makeMockGroup() as any);

    // feetY=96 → tolerance window = [−∞, 98]
    // slab y=100 top=96 ≤ 98 ✓  slab y=104 top=100 > 98 ✗
    expect(collider.getSurfaceYAtX(150, 96)).toBe(96);
  });

  it('returns null when worldX is outside all rows', () => {
    const collider = new HeapEdgeCollider(null as any);
    collider.buildFromScanlines(0, [
      { y: 100, leftX: 50, rightX: 300 },
    ], makeMockGroup() as any, makeMockGroup() as any);

    expect(collider.getSurfaceYAtX(400, 96)).toBeNull();
  });

  it('returns null when the covering slab top is too far below the player', () => {
    const collider = new HeapEdgeCollider(null as any);
    collider.buildFromScanlines(0, [
      { y: 200, leftX: 50, rightX: 300 }, // slabTop = 196
    ], makeMockGroup() as any, makeMockGroup() as any);

    // feetY=190 → threshold = 192.  196 > 192 → not valid.
    expect(collider.getSurfaceYAtX(150, 190)).toBeNull();
  });

  it('ignores far-off bands and returns the band nearest the player', () => {
    const collider = new HeapEdgeCollider(null as any);
    collider.buildFromScanlines(0,   [{ y: 100, leftX: 50, rightX: 300 }], makeMockGroup() as any, makeMockGroup() as any);
    collider.buildFromScanlines(500, [{ y: 600, leftX: 50, rightX: 300 }], makeMockGroup() as any, makeMockGroup() as any);

    // feetY=96: band 0 slabTop=96 ≤ 98 ✓   band 500 slabTop=596 > 98 ✗
    expect(collider.getSurfaceYAtX(150, 96)).toBe(96);
  });

  it('returns null after destroyBand removes the only covering row', () => {
    const collider = new HeapEdgeCollider(null as any);
    collider.buildFromScanlines(0, [
      { y: 100, leftX: 50, rightX: 300 },
    ], makeMockGroup() as any, makeMockGroup() as any);
    collider.destroyBand(0);

    expect(collider.getSurfaceYAtX(150, 96)).toBeNull();
  });
});

// ── walkableSlopeDeg ──────────────────────────────────────────────────────────

describe('HeapEdgeCollider – walkableSlopeDeg', () => {
  it('classifies 45° left-edge slabs as walkable when threshold is 60°', () => {
    const walkableGroup = makeMockGroup();
    const wallGroup     = makeMockGroup();

    const collider = new HeapEdgeCollider(null as any, 60);
    collider.buildFromScanlines(0, rows45deg, walkableGroup as any, wallGroup as any);

    // Left spans (45° < 60°) go to walkableGroup
    expect(walkableGroup.create).toHaveBeenCalled();
  });

  it('classifies the same 45° left-edge slabs as walls at the default 35° threshold', () => {
    const walkableGroup = makeMockGroup();
    const wallGroup     = makeMockGroup();

    // No second argument → defaults to MAX_WALKABLE_SLOPE_DEG (35°)
    const collider = new HeapEdgeCollider(null as any);
    collider.buildFromScanlines(0, rows45deg, walkableGroup as any, wallGroup as any);

    // Both left (45°) and right (90°) exceed 35° → all slabs go to wallGroup
    expect(walkableGroup.create).not.toHaveBeenCalled();
  });
});
