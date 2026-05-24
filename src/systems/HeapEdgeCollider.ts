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
  verticesToScanlines,
  ScanlineRow,
  Vertex,
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
  /** Raw scanline rows per band — used for surface Y queries. */
  private readonly bandRows:   Map<number, ScanlineRow[]>                  = new Map();
  private readonly walkableSlopeDeg: number;

  constructor(_scene: Phaser.Scene, walkableSlopeDeg = MAX_WALKABLE_SLOPE_DEG) {
    this.walkableSlopeDeg = walkableSlopeDeg;
  }

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
    const rows = verticesToScanlines(vertices);
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
    this.bandRows.delete(bandTop);
  }

  /**
   * Return the top Y of the highest slab (smallest Y) that covers worldX,
   * within a 2px tolerance below playerFeetY. Returns null when no slab qualifies.
   */
  getSurfaceYAtX(worldX: number, playerFeetY: number): number | null {
    const tolerance = 2;
    let best: number | null = null;
    for (const rows of this.bandRows.values()) {
      for (const row of rows) {
        if (worldX >= row.leftX && worldX <= row.rightX) {
          const slabTop = row.y - FLOOR_BODY_HEIGHT / 2;
          if (slabTop <= playerFeetY + tolerance) {
            if (best === null || slabTop < best) best = slabTop;
          }
        }
      }
    }
    return best;
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
      const row      = rows[i];
      const rowBelow = i + 1 < rows.length ? rows[i + 1] : null;

      const leftIsWall  = computeRowSlopeAngleDeg(rows, i, 'left')  > this.walkableSlopeDeg;
      const rightIsWall = computeRowSlopeAngleDeg(rows, i, 'right') > this.walkableSlopeDeg;

      // Overhang: this row extends further out than the row below (heap gets wider going up).
      // Overhang undersides should block the player jumping from below.
      const leftIsOverhang  = rowBelow !== null && row.leftX  < rowBelow.leftX;
      const rightIsOverhang = rowBelow !== null && row.rightX > rowBelow.rightX;

      const centerX     = (row.leftX + row.rightX) / 2;
      const spanleft    = Math.abs(row.leftX  - centerX);
      const spanright   = Math.abs(row.rightX - centerX);
      const middleLeft  = centerX - spanleft  / 2;
      const middleRight = centerX + spanright / 2;

      bodies.push(this.createSpan(leftIsWall  ? wallGroup : walkableGroup, middleLeft,  row.y, spanleft,  leftIsWall,  'left',  leftIsOverhang));
      bodies.push(this.createSpan(rightIsWall ? wallGroup : walkableGroup, middleRight, row.y, spanright, rightIsWall, 'right', rightIsOverhang));
    }

    this.bandBodies.set(bandTop, bodies);
    this.bandRows.set(bandTop, rows);
  }

  private createSpan(
    group: Phaser.Physics.Arcade.StaticGroup,
    x: number,
    y: number,
    width: number,
    isWall: boolean = false,
    wallSide?: 'left' | 'right',
    isOverhang: boolean = false,
  ): Phaser.Physics.Arcade.Image {
    const img = group.create(x, y) as Phaser.Types.Physics.Arcade.ImageWithStaticBody;
    img.setVisible(false);
    img.setDisplaySize(width, FLOOR_BODY_HEIGHT);
    img.setDebugBodyColor(isWall ? 0xff0000 : 0x00ff00);
    img.refreshBody();
    if (isWall) {
      const staticBody = img.body as Phaser.Physics.Arcade.StaticBody;
      if (!isOverhang) staticBody.checkCollision.down = false;
      if (wallSide) img.setData('wallSide', wallSide);
    }
    return img as unknown as Phaser.Physics.Arcade.Image;
  }
}
