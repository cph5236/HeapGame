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
  const created: ReturnType<typeof makeMockImg>[] = [];
  return {
    create: vi.fn(() => {
      const img = makeMockImg();
      created.push(img);
      return img;
    }),
    created,
  };
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
    const collider = new HeapEdgeCollider();
    collider.buildFromScanlines(0, [
      { y: 100, leftX: 50, rightX: 300 }, // slabTop = 96
      { y: 104, leftX: 50, rightX: 300 }, // slabTop = 100
    ], makeMockGroup() as any, makeMockGroup() as any);

    // feetY=96 → tolerance window = [−∞, 98]
    // slab y=100 top=96 ≤ 98 ✓  slab y=104 top=100 > 98 ✗
    expect(collider.getSurfaceYAtX(150, 96)).toBe(96);
  });

  it('returns null when worldX is outside all rows', () => {
    const collider = new HeapEdgeCollider();
    collider.buildFromScanlines(0, [
      { y: 100, leftX: 50, rightX: 300 },
    ], makeMockGroup() as any, makeMockGroup() as any);

    expect(collider.getSurfaceYAtX(400, 96)).toBeNull();
  });

  it('returns null when the covering slab top is too far below the player', () => {
    const collider = new HeapEdgeCollider();
    collider.buildFromScanlines(0, [
      { y: 200, leftX: 50, rightX: 300 }, // slabTop = 196
    ], makeMockGroup() as any, makeMockGroup() as any);

    // feetY=190 → threshold = 192.  196 > 192 → not valid.
    expect(collider.getSurfaceYAtX(150, 190)).toBeNull();
  });

  it('ignores far-off bands and returns the band nearest the player', () => {
    const collider = new HeapEdgeCollider();
    collider.buildFromScanlines(0,   [{ y: 100, leftX: 50, rightX: 300 }], makeMockGroup() as any, makeMockGroup() as any);
    collider.buildFromScanlines(500, [{ y: 600, leftX: 50, rightX: 300 }], makeMockGroup() as any, makeMockGroup() as any);

    // feetY=96: band 0 slabTop=96 ≤ 98 ✓   band 500 slabTop=596 > 98 ✗
    expect(collider.getSurfaceYAtX(150, 96)).toBe(96);
  });

  it('returns null after destroyBand removes the only covering row', () => {
    const collider = new HeapEdgeCollider();
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

    const collider = new HeapEdgeCollider(60);
    collider.buildFromScanlines(0, rows45deg, walkableGroup as any, wallGroup as any);

    // Left spans (45° < 60°) go to walkableGroup
    expect(walkableGroup.create).toHaveBeenCalled();
  });

  it('classifies the same 45° left-edge slabs as walls at the default 35° threshold', () => {
    const walkableGroup = makeMockGroup();
    const wallGroup     = makeMockGroup();

    // No second argument → defaults to MAX_WALKABLE_SLOPE_DEG (35°)
    const collider = new HeapEdgeCollider();
    collider.buildFromScanlines(0, rows45deg, walkableGroup as any, wallGroup as any);

    // Both left (45°) and right (90°) exceed 35° → all slabs go to wallGroup
    expect(walkableGroup.create).not.toHaveBeenCalled();
  });
});

// ── Characterization: slope threshold at boundary ──────────────────────────

describe('HeapEdgeCollider – slope classification at threshold', () => {
  it('classifies slopes just below threshold as walkable', () => {
    // Threshold is 35°. We want a slope just below, so use ~29.74°.
    // slope = atan2(SCAN_STEP=4, deltaX) → atan2(4, 7) ≈ 29.74° < 35° ✓
    const walkableGroup = makeMockGroup();
    const wallGroup = makeMockGroup();

    const rows: ScanlineRow[] = [
      { y: 0, leftX: 100, rightX: 200 },
      { y: 4, leftX: 107, rightX: 200 }, // deltaX = 7 → ~29.74° < 35°
      { y: 8, leftX: 114, rightX: 200 },
    ];

    const collider = new HeapEdgeCollider(35);
    collider.buildFromScanlines(0, rows, walkableGroup as any, wallGroup as any);

    // Left edge is walkable; right edge is vertical (90°, wall)
    expect(walkableGroup.create).toHaveBeenCalled();
    expect(wallGroup.create).toHaveBeenCalled();
  });

  it('classifies slopes just above threshold as walls', () => {
    // Threshold is 35°. We want a slope just above, so use ~38.66°.
    // slope = atan2(SCAN_STEP=4, deltaX) → atan2(4, 5) ≈ 38.66° > 35° ✓
    const walkableGroup = makeMockGroup();
    const wallGroup = makeMockGroup();

    const rows: ScanlineRow[] = [
      { y: 0, leftX: 100, rightX: 200 },
      { y: 4, leftX: 105, rightX: 200 }, // deltaX = 5 → ~38.66° > 35°
      { y: 8, leftX: 110, rightX: 200 },
    ];

    const collider = new HeapEdgeCollider(35);
    collider.buildFromScanlines(0, rows, walkableGroup as any, wallGroup as any);

    // Both left (38.66°) and right (90°) exceed 35° → all go to wallGroup
    expect(wallGroup.create).toHaveBeenCalled();
    expect(walkableGroup.create).not.toHaveBeenCalled();
  });
});

// ── Characterization: overhang detection (checkCollision.down) ──────────────

describe('HeapEdgeCollider – overhang classification', () => {
  it('marks wall slabs as overhang when upper row leftX < row below leftX', () => {
    const walkableGroup = makeMockGroup();
    const wallGroup = makeMockGroup();

    // Overhang: row above is narrower (leftX shrinks → upper extends left).
    // Use steep slope (deltaX=5) so edges are walls (angle ≈ 38.66° > 35°).
    const rows: ScanlineRow[] = [
      { y: 0, leftX: 90, rightX: 210 },  // row 0 (upper): narrower left (leftX=90)
      { y: 4, leftX: 95, rightX: 210 },  // row 1 (lower): wider left (leftX=95)
      { y: 8, leftX: 100, rightX: 210 }, // row 2: continue slope
    ];

    const collider = new HeapEdgeCollider(35);
    collider.buildFromScanlines(0, rows, walkableGroup as any, wallGroup as any);

    // wallGroup.created ordering: [r0L, r0R, r1L, r1R, r2L, r2R]
    // Row 0 left (index 0): leftIsOverhang = true (90 < 95) → checkCollision.down stays true
    // Row 0 right (index 1): rightIsOverhang = false (210 >= 210) → checkCollision.down = false
    // Row 1 left (index 2): leftIsOverhang = true (95 < 100) → checkCollision.down stays true
    // Row 1 right (index 3): rightIsOverhang = false (210 >= 210) → checkCollision.down = false
    // Row 2 left (index 4): no rowBelow → leftIsOverhang = false → checkCollision.down = false
    // Row 2 right (index 5): no rowBelow → rightIsOverhang = false → checkCollision.down = false
    expect(wallGroup.created[0].body.checkCollision.down).toBe(true); // r0 left overhang
    expect(wallGroup.created[1].body.checkCollision.down).toBe(false); // r0 right non-overhang
    expect(wallGroup.created[2].body.checkCollision.down).toBe(true); // r1 left overhang
    expect(wallGroup.created[3].body.checkCollision.down).toBe(false); // r1 right non-overhang
    expect(wallGroup.created[4].body.checkCollision.down).toBe(false); // r2 left no rowBelow
    expect(wallGroup.created[5].body.checkCollision.down).toBe(false); // r2 right no rowBelow
  });

  it('marks wall slabs as non-overhang when upper row leftX >= row below leftX', () => {
    const walkableGroup = makeMockGroup();
    const wallGroup = makeMockGroup();

    // No overhang: row above is same width or wider (leftX does not shrink).
    // Use steep slope (deltaX=5) so edges are walls.
    const rows: ScanlineRow[] = [
      { y: 0, leftX: 100, rightX: 210 }, // row 0 (upper): leftX = 100
      { y: 4, leftX: 100, rightX: 210 }, // row 1 (lower): leftX = 100 (not narrower)
      { y: 8, leftX: 100, rightX: 210 }, // row 2: vertical
    ];

    const collider = new HeapEdgeCollider(35);
    collider.buildFromScanlines(0, rows, walkableGroup as any, wallGroup as any);

    // wallGroup.created ordering: [r0L, r0R, r1L, r1R, r2L, r2R]
    // All rows: leftIsOverhang = false (leftX never shrinks), rightIsOverhang = false (rightX constant)
    // All indices should have checkCollision.down = false
    for (let i = 0; i < wallGroup.created.length; i++) {
      expect(wallGroup.created[i].body.checkCollision.down).toBe(false);
    }
  });

  it('marks wall slabs as overhang when upper row rightX > row below rightX', () => {
    const walkableGroup = makeMockGroup();
    const wallGroup = makeMockGroup();

    // Right overhang: row above extends right beyond row below (heap widens up).
    // Use steep slope (deltaX=5) so right edge is a wall.
    const rows: ScanlineRow[] = [
      { y: 0, leftX: 100, rightX: 220 }, // row 0 (upper): rightX = 220
      { y: 4, leftX: 100, rightX: 215 }, // row 1 (lower): rightX = 215 (narrower)
      { y: 8, leftX: 100, rightX: 210 }, // row 2: continue slope
    ];

    const collider = new HeapEdgeCollider(35);
    collider.buildFromScanlines(0, rows, walkableGroup as any, wallGroup as any);

    // wallGroup.created ordering: [r0L, r0R, r1L, r1R, r2L, r2R]
    // Row 0 left (index 0): leftIsOverhang = false (100 >= 100) → checkCollision.down = false
    // Row 0 right (index 1): rightIsOverhang = true (220 > 215) → checkCollision.down stays true
    // Row 1 left (index 2): leftIsOverhang = false (100 >= 100) → checkCollision.down = false
    // Row 1 right (index 3): rightIsOverhang = true (215 > 210) → checkCollision.down stays true
    // Row 2 left (index 4): no rowBelow → leftIsOverhang = false → checkCollision.down = false
    // Row 2 right (index 5): no rowBelow → rightIsOverhang = false → checkCollision.down = false
    expect(wallGroup.created[0].body.checkCollision.down).toBe(false); // r0 left non-overhang
    expect(wallGroup.created[1].body.checkCollision.down).toBe(true);  // r0 right overhang
    expect(wallGroup.created[2].body.checkCollision.down).toBe(false); // r1 left non-overhang
    expect(wallGroup.created[3].body.checkCollision.down).toBe(true);  // r1 right overhang
    expect(wallGroup.created[4].body.checkCollision.down).toBe(false); // r2 left no rowBelow
    expect(wallGroup.created[5].body.checkCollision.down).toBe(false); // r2 right no rowBelow
  });
});

// ── Characterization: wallSide setData calls ───────────────────────────────

describe('HeapEdgeCollider – wallSide setData', () => {
  it("calls setData('wallSide', 'left') on left wall slabs and not on walkable", () => {
    const walkableGroup = makeMockGroup();
    const wallGroup = makeMockGroup();

    // Steep left edge (wall), vertical right edge (wall)
    const rows: ScanlineRow[] = [
      { y: 0, leftX: 100, rightX: 200 },
      { y: 4, leftX: 102, rightX: 200 }, // deltaX = 2 → ≈ 63.43° (very steep, well above 35°)
      { y: 8, leftX: 104, rightX: 200 },
    ];

    const collider = new HeapEdgeCollider(35);
    collider.buildFromScanlines(0, rows, walkableGroup as any, wallGroup as any);

    // Both left and right are walls → wallGroup.created = [r0L, r0R, r1L, r1R, r2L, r2R]
    // Left slabs (indices 0, 2, 4) should have setData('wallSide', 'left')
    expect(wallGroup.created[0].setData).toHaveBeenCalledWith('wallSide', 'left');
    expect(wallGroup.created[2].setData).toHaveBeenCalledWith('wallSide', 'left');
    expect(wallGroup.created[4].setData).toHaveBeenCalledWith('wallSide', 'left');
    // Right slabs (indices 1, 3, 5) should have setData('wallSide', 'right')
    expect(wallGroup.created[1].setData).toHaveBeenCalledWith('wallSide', 'right');
    expect(wallGroup.created[3].setData).toHaveBeenCalledWith('wallSide', 'right');
    expect(wallGroup.created[5].setData).toHaveBeenCalledWith('wallSide', 'right');
  });

  it("calls setData('wallSide', 'right') on right wall slabs", () => {
    const walkableGroup = makeMockGroup();
    const wallGroup = makeMockGroup();

    // Very gentle left edge that widens going down (walkable, not an overhang),
    // vertical right edge (wall).
    const rows: ScanlineRow[] = [
      { y: 0, leftX: 130, rightX: 200 },
      { y: 4, leftX: 115, rightX: 200 }, // deltaX = 15 → very gentle (~15°)
      { y: 8, leftX: 100, rightX: 200 },
    ];

    const collider = new HeapEdgeCollider(35);
    collider.buildFromScanlines(0, rows, walkableGroup as any, wallGroup as any);

    // Left is walkable → goes to walkableGroup; right is wall → goes to wallGroup
    // wallGroup.created contains only right wall slabs [r0R, r1R, r2R] at indices 0, 1, 2
    expect(walkableGroup.create).toHaveBeenCalled();
    expect(wallGroup.create).toHaveBeenCalled();
    expect(wallGroup.created[0].setData).toHaveBeenCalledWith('wallSide', 'right');
    expect(wallGroup.created[1].setData).toHaveBeenCalledWith('wallSide', 'right');
    expect(wallGroup.created[2].setData).toHaveBeenCalledWith('wallSide', 'right');
  });

  it('does not call setData on walkable slabs', () => {
    const walkableGroup = makeMockGroup();
    const wallGroup = makeMockGroup();

    // Very gentle slopes on both sides (both < 35°) that widen going down, so neither
    // is an overhang → both walkable.
    const rows: ScanlineRow[] = [
      { y: 0, leftX: 130, rightX: 170 },
      { y: 4, leftX: 115, rightX: 185 }, // deltaX = 15 each → ~15° both
      { y: 8, leftX: 100, rightX: 200 },
    ];

    const collider = new HeapEdgeCollider(35);
    collider.buildFromScanlines(0, rows, walkableGroup as any, wallGroup as any);

    // Both left and right are walkable → all go to walkableGroup, none to wallGroup
    expect(wallGroup.create).not.toHaveBeenCalled();
    // Verify walkable slabs do not have setData('wallSide', ...) calls
    for (const walkableImg of walkableGroup.created) {
      expect(walkableImg.setData).not.toHaveBeenCalledWith(
        'wallSide',
        expect.anything(),
      );
    }
  });

  it('classifies a gentle continuous OUTWARD-leaning ramp as WALKABLE, not a wall', () => {
    const walkableGroup = makeMockGroup();
    const wallGroup = makeMockGroup();

    // A shallow (~30°) left edge that leans outward as it rises: each row juts out
    // ~7px over the row below. The slope is walkable and the per-row jut is small —
    // this is a climbable ramp, NOT a perchable lip, so it must be walkable.
    // (Regression: previously ANY outward lean forced these surfaces to walls, which
    //  disabled their tops and ejected the player sideways — the reported bug.)
    const rows: ScanlineRow[] = [
      { y: 0, leftX: 100, rightX: 300 },
      { y: 4, leftX: 107, rightX: 300 }, // jut = 7px over row below, slope ≈ 30°
      { y: 8, leftX: 114, rightX: 300 },
    ];

    const collider = new HeapEdgeCollider(35);
    collider.buildFromScanlines(0, rows, walkableGroup as any, wallGroup as any);

    // The left ramp slabs must be walkable; only the vertical right edge is a wall.
    expect(walkableGroup.create).toHaveBeenCalled();
    expect(wallGroup.created.some(img =>
      (img.setData as any).mock.calls.some((c: unknown[]) => c[0] === 'wallSide' && c[1] === 'left'),
    )).toBe(false);
  });

  it('classifies a PRONOUNCED jutting lip (large outward jut) as a wall', () => {
    const walkableGroup = makeMockGroup();
    const wallGroup = makeMockGroup();

    // A near-flat row that juts out far (≫ threshold) over the row below — a perchable
    // lip on an otherwise steep face. Must stay a non-standable wall so it can't be
    // used to refresh air jumps (the original overhang intent).
    const rows: ScanlineRow[] = [
      { y: 0, leftX: 100, rightX: 300 },
      { y: 4, leftX: 140, rightX: 300 }, // jut = 40px over row below → lip
      { y: 8, leftX: 145, rightX: 300 },
    ];

    const collider = new HeapEdgeCollider(35);
    collider.buildFromScanlines(0, rows, walkableGroup as any, wallGroup as any);

    // Row 0's left edge juts 40px over row 1 → wall tagged wallSide 'left'.
    expect(wallGroup.created.some(img =>
      (img.setData as any).mock.calls.some((c: unknown[]) => c[0] === 'wallSide' && c[1] === 'left'),
    )).toBe(true);
  });

  it('keeps the bottom row of a vertical wall above a contraction non-standable (no perchable lip)', () => {
    const walkableGroup = makeMockGroup();
    const wallGroup = makeMockGroup();

    // Real-data shape (normal mode, observed player perch): a vertical left wall
    // (leftX≈157) that contracts at its base — leftX climbs going down. The
    // min()-of-segments slope rule flips the LAST vertical row (y=8) to walkable
    // because its single downward segment into the contraction is shallow (≈34°),
    // giving it a solid top a wall-sliding player barely catches to refresh air
    // jumps. Because its row above is a wall and it leans outward, it must stay a
    // wall. The genuine contraction ramp below it (y≥12) must remain walkable.
    const rows: ScanlineRow[] = [
      { y: 0,  leftX: 157, rightX: 828 }, // vertical wall
      { y: 4,  leftX: 157, rightX: 828 }, // vertical wall
      { y: 8,  leftX: 157, rightX: 828 }, // wall base: above is wall, below juts to 163 (overhang, shallow)
      { y: 12, leftX: 163, rightX: 827 }, // contraction ramp — genuine walkable
      { y: 16, leftX: 176, rightX: 823 }, // contraction ramp
      { y: 20, leftX: 189, rightX: 820 }, // contraction ramp
    ];

    const collider = new HeapEdgeCollider(35);
    collider.buildFromScanlines(0, rows, walkableGroup as any, wallGroup as any);

    const countAtY = (g: ReturnType<typeof makeMockGroup>, y: number) =>
      g.create.mock.calls.filter((c: unknown[]) => c[1] === y).length;

    // The y=8 wall-base row must be fully wall (both sides) — no walkable left lip.
    expect(countAtY(walkableGroup, 8)).toBe(0);
    expect(countAtY(wallGroup, 8)).toBe(2);

    // No cascade: the contraction ramp just below stays a walkable surface.
    expect(countAtY(walkableGroup, 12)).toBe(1); // left ramp slab is walkable
    expect(countAtY(wallGroup, 12)).toBe(1);     // only the steep right edge is a wall
  });
});

// ── Flat plateau on vertical walls: exposed-summit classification ───────────

describe('HeapEdgeCollider – flat plateau top (exposed summit)', () => {
  const countAtY = (g: ReturnType<typeof makeMockGroup>, y: number) =>
    g.create.mock.calls.filter((c: unknown[]) => c[1] === y).length;

  it('makes a flat plateau top walkable when it is a true summit below bandTop', () => {
    const walkableGroup = makeMockGroup();
    const wallGroup = makeMockGroup();

    // A wide flat plateau (constant leftX/rightX) sitting on vertical walls.
    // The top row's deltaX against the identical wall row below is 0 → would read
    // 90° (wall) under the side-slope rule. But its Y (1010) is strictly below the
    // band top (1000), so it is a genuine exposed summit and its top must stand.
    const rows: ScanlineRow[] = [
      { y: 1010, leftX: 215, rightX: 745 }, // plateau top — summit (1010 > 1000)
      { y: 1014, leftX: 215, rightX: 745 }, // vertical wall below
      { y: 1018, leftX: 215, rightX: 745 }, // vertical wall below
    ];

    const collider = new HeapEdgeCollider(35);
    collider.buildFromScanlines(1000, rows, walkableGroup as any, wallGroup as any);

    // Top row: both half-slabs walkable (solid top spanning the full plateau).
    expect(countAtY(walkableGroup, 1010)).toBe(2);
    expect(countAtY(wallGroup, 1010)).toBe(0);

    // The vertical sides below the plateau stay walls — you can't walk through them.
    expect(countAtY(wallGroup, 1014)).toBe(2);
    expect(countAtY(walkableGroup, 1014)).toBe(0);
  });

  it('keeps a wall clipped at the band boundary (y === bandTop) a wall, not a ledge', () => {
    const walkableGroup = makeMockGroup();
    const wallGroup = makeMockGroup();

    // A tall vertical wall threading through this band from the band above is clipped
    // at exactly y = bandTop. Its top row is NOT a summit — making it walkable would
    // be a phantom mid-wall ledge that refreshes air-jumps. It must stay a wall.
    const rows: ScanlineRow[] = [
      { y: 1000, leftX: 215, rightX: 745 }, // clip row at bandTop — not a summit
      { y: 1004, leftX: 215, rightX: 745 },
      { y: 1008, leftX: 215, rightX: 745 },
    ];

    const collider = new HeapEdgeCollider(35);
    collider.buildFromScanlines(1000, rows, walkableGroup as any, wallGroup as any);

    expect(countAtY(walkableGroup, 1000)).toBe(0);
    expect(countAtY(wallGroup, 1000)).toBe(2);
  });
});

// ── Characterization: cullBands ────────────────────────────────────────────

describe('HeapEdgeCollider – cullBands', () => {
  it('removes bands above the cull threshold', () => {
    const collider = new HeapEdgeCollider();

    // Build two bands: only band above cull threshold will be removed
    // Use bands that don't overlap in worldX so we can query them separately
    collider.buildFromScanlines(100, [{ y: 200, leftX: 50, rightX: 100 }], makeMockGroup() as any, makeMockGroup() as any);
    collider.buildFromScanlines(2000, [{ y: 2100, leftX: 200, rightX: 250 }], makeMockGroup() as any, makeMockGroup() as any);

    // Before cull: both bands exist and are queryable at different X positions
    expect(collider.getSurfaceYAtX(75, 196)).toBe(196);    // band 100, worldX=75
    expect(collider.getSurfaceYAtX(225, 2098)).toBe(2096); // band 2000, worldX=225

    // Call cullBands(camBottom=200, cullDistance=500)
    // → threshold = 200 + 500 = 700
    // → band 100 (top=100) ≤ 700 ✓ survives
    // → band 2000 (top=2000) > 700 ✗ removed
    collider.cullBands(200, 500);

    // After cull: band 100 survives, band 2000 is gone
    expect(collider.getSurfaceYAtX(75, 196)).toBe(196);    // band 100 still works
    expect(collider.getSurfaceYAtX(225, 2098)).toBeNull(); // band 2000 removed
  });
});

// ── Characterization: destroyBand removes bandRows ──────────────────────────

describe('HeapEdgeCollider – destroyBand', () => {
  it('removes bandRows entries and prevents getSurfaceYAtX from returning stale data', () => {
    const collider = new HeapEdgeCollider();

    // Build first band
    collider.buildFromScanlines(0, [
      { y: 100, leftX: 50, rightX: 300 },
    ], makeMockGroup() as any, makeMockGroup() as any);

    // Verify it works
    expect(collider.getSurfaceYAtX(150, 96)).toBe(96);

    // Destroy it
    collider.destroyBand(0);

    // After destroy, no row should be found
    expect(collider.getSurfaceYAtX(150, 96)).toBeNull();

    // Build a different band at a different bandTop to confirm
    // the collider still works and didn't hold stale data
    collider.buildFromScanlines(500, [
      { y: 600, leftX: 50, rightX: 300 },
    ], makeMockGroup() as any, makeMockGroup() as any);

    // The new band should work
    expect(collider.getSurfaceYAtX(150, 596)).toBe(596);

    // But the old band should still be gone
    expect(collider.getSurfaceYAtX(150, 96)).toBeNull();
  });
});
