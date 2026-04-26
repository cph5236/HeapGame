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
