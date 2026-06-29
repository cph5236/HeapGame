import { describe, it, expect, vi } from 'vitest';
import { TUTORIAL_HEAP } from '../tutorialFixture';
import { clipPolygonToBand } from '../../systems/HeapPolygonLoader';
import { verticesToScanlines } from '../../systems/HeapPolygon';
import { HeapEdgeCollider } from '../../systems/HeapEdgeCollider';
import { CHUNK_BAND_HEIGHT } from '../../constants';

// Phaser StaticGroup mock — HeapEdgeCollider only calls group.create() then a few
// chainable methods on the returned image. Mirrors the mock in HeapEdgeCollider.test.ts.
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

// End-to-end guard tying the real tutorial fixture to the collider via the same
// banding + scanline path the game uses (clipPolygonToBand → verticesToScanlines →
// buildFromScanlines). Regression for "Flat plateau top misclassified as a vertical
// wall": the fixture's flat summit (constant y = H-590, on vertical walls) must be a
// standable platform, not an ejecting wall.
describe('tutorial fixture — flat plateau summit is standable', () => {
  const countAtY = (g: ReturnType<typeof makeMockGroup>, y: number) =>
    g.create.mock.calls.filter((c: unknown[]) => c[1] === y).length;

  it('classifies the plateau top row as walkable, with vertical walls below', () => {
    const minY = Math.min(...TUTORIAL_HEAP.map(v => v.y));
    const bandTop = Math.floor(minY / CHUNK_BAND_HEIGHT) * CHUNK_BAND_HEIGHT;

    const bandVertices = clipPolygonToBand(TUTORIAL_HEAP, bandTop, bandTop + CHUNK_BAND_HEIGHT);
    const rows = verticesToScanlines(bandVertices);

    // The summit row is the topmost scanline, strictly below the band top (a genuine
    // exposed top), spanning the full plateau width.
    const topY = rows[0].y;
    expect(topY).toBeGreaterThan(bandTop);
    expect(rows[0].leftX).toBe(215);
    expect(rows[0].rightX).toBe(745);
    // The row directly below has identical extents (the vertical walls) — that is the
    // geometry that used to read 90° and eject the player.
    expect(rows[1].leftX).toBe(rows[0].leftX);
    expect(rows[1].rightX).toBe(rows[0].rightX);

    const walkableGroup = makeMockGroup();
    const wallGroup = makeMockGroup();
    new HeapEdgeCollider(35).buildFromScanlines(bandTop, rows, walkableGroup as any, wallGroup as any);

    // Plateau top: both half-slabs walkable → a solid full-width platform to stand on.
    expect(countAtY(walkableGroup, topY)).toBe(2);
    expect(countAtY(wallGroup, topY)).toBe(0);

    // The vertical faces below the plateau stay walls — the player can't walk through them.
    expect(countAtY(wallGroup, rows[1].y)).toBe(2);
    expect(countAtY(walkableGroup, rows[1].y)).toBe(0);
  });
});
