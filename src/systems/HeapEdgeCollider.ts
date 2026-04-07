import Phaser from 'phaser';
import { HeapEntry } from '../data/heapTypes';
import {
  CHUNK_BAND_HEIGHT,
  MAX_WALKABLE_SLOPE_DEG,
  FLOOR_BODY_HEIGHT,
} from '../constants';
import {
  computeBandScanlines,
  computeRowSlopeAngleDeg,
  ScanlineRow,
  Vertex,
  SCAN_STEP,
} from './HeapPolygon';

/**
 * Manages static-body slabs placed along the left/right boundaries of each
 * heap chunk band. One 10×20px slab per ScanlineRow per edge → 16px Y overlap
 * between adjacent slabs, making diagonal gaps impossible.
 *
 * Slabs are classified as walkable (slope ≤ MAX_WALKABLE_SLOPE_DEG) or wall
 * (steeper) and placed into the appropriate StaticGroup so GameScene can wire
 * different collision responses for each.
 *
 * Two input paths:
 *  - buildFromScanlines() — local path; directly receives ScanlineRow[]
 *  - buildFromVertices()  — server path; rasterizes the polygon to ScanlineRow[]
 */
export class HeapEdgeCollider {
  /** All edge bodies per band, keyed by bandTop. */
  private readonly bandBodies: Map<number, Phaser.Physics.Arcade.Image[]> = new Map();

  constructor(_scene: Phaser.Scene) {}

  // ── Local path ─────────────────────────────────────────────────────────────

  buildFromScanlines(
    bandTop: number,
    rows: ScanlineRow[],
    walkableGroup: Phaser.Physics.Arcade.StaticGroup,
    wallGroup: Phaser.Physics.Arcade.StaticGroup,
  ): void {
    if (rows.length === 0) { this.destroyBand(bandTop); return; }
    this.buildSlabs(bandTop, rows, walkableGroup, wallGroup);
  }

  // ── Server path ────────────────────────────────────────────────────────────

  buildFromVertices(
    bandTop: number,
    vertices: Vertex[],
    walkableGroup: Phaser.Physics.Arcade.StaticGroup,
    wallGroup: Phaser.Physics.Arcade.StaticGroup,
  ): void {
    const rows = HeapEdgeCollider.verticesToScanlines(vertices);
    if (rows.length === 0) { this.destroyBand(bandTop); return; }
    this.buildSlabs(bandTop, rows, walkableGroup, wallGroup);
  }

  // ── Convenience: rebuild a band from raw entries ───────────────────────────

  rebuildBand(
    bandTop: number,
    entries: HeapEntry[],
    walkableGroup: Phaser.Physics.Arcade.StaticGroup,
    wallGroup: Phaser.Physics.Arcade.StaticGroup,
  ): void {
    const rows = computeBandScanlines(entries, bandTop, bandTop + CHUNK_BAND_HEIGHT);
    this.buildFromScanlines(bandTop, rows, walkableGroup, wallGroup);
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  destroyBand(bandTop: number): void {
    const bodies = this.bandBodies.get(bandTop);
    if (bodies) {
      for (const body of bodies) body.destroy();
      this.bandBodies.delete(bandTop);
    }
  }

  cullBands(camBottom: number, cullDistance: number): void {
    const threshold = camBottom + cullDistance;
    for (const [bandTop] of this.bandBodies) {
      if (bandTop > threshold) this.destroyBand(bandTop);
    }
  }

  // ── Core: wall edges get narrow tall slabs; walkable rows get a full-width span ──

  private buildSlabs(
    bandTop: number,
    rows: ScanlineRow[],
    walkableGroup: Phaser.Physics.Arcade.StaticGroup,
    wallGroup: Phaser.Physics.Arcade.StaticGroup,
  ): void {
    this.destroyBand(bandTop);
    const bodies: Phaser.Physics.Arcade.Image[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      const leftIsWall  = computeRowSlopeAngleDeg(rows, i, 'left')  > MAX_WALKABLE_SLOPE_DEG;
      const rightIsWall = computeRowSlopeAngleDeg(rows, i, 'right') > MAX_WALKABLE_SLOPE_DEG;

      // Gentle edges → one wide flat body spanning the full row width
      const spanWidth = row.rightX - row.leftX;
      const centerX   = (row.leftX + row.rightX) / 2;
      bodies.push(this.createSpan(leftIsWall&&rightIsWall ? wallGroup : walkableGroup, centerX, row.y, spanWidth));
    
    }

    this.bandBodies.set(bandTop, bodies);
  }

  private createSpan(
    group: Phaser.Physics.Arcade.StaticGroup,
    x: number,
    y: number,
    width: number,
  ): Phaser.Physics.Arcade.Image {
    const img = group.create(x, y) as Phaser.Types.Physics.Arcade.ImageWithStaticBody;
    img.setVisible(false);
    img.setDisplaySize(width, FLOOR_BODY_HEIGHT);
    img.refreshBody();
    return img as unknown as Phaser.Physics.Arcade.Image;
  }

  // ── Vertex → ScanlineRow[] rasterization (server path) ────────────────────

  /**
   * Convert a closed polygon to ScanlineRow[] using a standard scanline scan.
   * Works for any convex or concave polygon.
   */
  private static verticesToScanlines(vertices: Vertex[]): ScanlineRow[] {
    if (vertices.length < 3) return [];

    const ys = vertices.map(v => v.y);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const rows: ScanlineRow[] = [];
    const n = vertices.length;

    for (let y = minY; y <= maxY; y += SCAN_STEP) {
      const xs: number[] = [];
      for (let i = 0; i < n; i++) {
        const a = vertices[i];
        const b = vertices[(i + 1) % n];
        // Edge crosses the horizontal scanline at y
        if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
          const t = (y - a.y) / (b.y - a.y);
          xs.push(a.x + t * (b.x - a.x));
        }
      }
      if (xs.length >= 2) {
        rows.push({ y, leftX: Math.min(...xs), rightX: Math.max(...xs) });
      }
    }

    return rows;
  }
}
