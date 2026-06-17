import Phaser from 'phaser';
import { HeapEntry } from '../data/heapTypes';
import {
  CHUNK_BAND_HEIGHT,
  MAX_WALKABLE_SLOPE_DEG,
  OVERHANG_WALL_MIN_JUT_PX,
  FLOOR_BODY_HEIGHT,
  SURFACE_QUERY_TOLERANCE_PX,
} from '../constants';
import {
  computeBandScanlines,
  computeRowSlopeAngleDeg,
  verticesToScanlines,
  ScanlineRow,
  Vertex,
} from './HeapPolygon';

// ──────────────────────────────────────────────────────────────────────────────
// Slab classification and geometry — internal to buildSlabs orchestration.
// ──────────────────────────────────────────────────────────────────────────────

/** What kind of body each row-side becomes. */
type SlabKind =
  | { kind: 'walkable' }
  | { kind: 'wall'; side: 'left' | 'right'; isOverhang: boolean };

/** Row-to-row classification: left and right edges. */
interface RowClassification {
  left:  SlabKind;
  right: SlabKind;
}

/** Geometry of a single slab (half-row). */
interface SlabSpan {
  x: number;
  w: number;
}

/** Geometry of both slabs from one row. */
interface RowGeometry {
  left:  SlabSpan;
  right: SlabSpan;
}

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
  private readonly bandBodies: Map<number, Phaser.Types.Physics.Arcade.ImageWithStaticBody[]> = new Map();
  /** Raw scanline rows per band — used for surface Y queries. */
  private readonly bandRows:   Map<number, ScanlineRow[]>                                        = new Map();
  private readonly walkableSlopeDeg: number;

  constructor(walkableSlopeDeg = MAX_WALKABLE_SLOPE_DEG) {
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
    const tolerance = SURFACE_QUERY_TOLERANCE_PX;
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

  /**
   * Base wall test for a single row-side, independent of neighbouring rows'
   * classification: a side is a wall if its slope is steep (> walkableSlopeDeg) OR
   * it juts out over the row below by more than OVERHANG_WALL_MIN_JUT_PX (a
   * pronounced, perchable lip). A small outward lean is just a gentle climbable
   * ramp and stays walkable. Deliberately excludes the wall-base rule in
   * classifyRow so that rule can never cascade down a genuine ramp.
   */
  private sideIsWallByBase(rows: ScanlineRow[], i: number, side: 'left' | 'right'): boolean {
    if (i < 0 || i >= rows.length) return false;
    const steep    = computeRowSlopeAngleDeg(rows, i, side) > this.walkableSlopeDeg;
    const rowBelow = i + 1 < rows.length ? rows[i + 1] : null;
    const jut = rowBelow === null ? 0
      : side === 'left' ? rowBelow.leftX - rows[i].leftX
      :                   rows[i].rightX - rowBelow.rightX;
    return steep || jut > OVERHANG_WALL_MIN_JUT_PX;
  }

  /**
   * Classify a row's left and right edges as walkable or wall.
   * Wall detection: slope > walkableSlopeDeg, or a pronounced overhang lip.
   * Overhang detection: row extends further out than the row below.
   */
  private classifyRow(rows: ScanlineRow[], i: number): RowClassification {
    const row      = rows[i];
    const rowBelow = i + 1 < rows.length ? rows[i + 1] : null;

    // Overhang: this row extends further out than the row below (heap gets wider going up).
    // `jut` is how far out it sticks (px); >0 means an overhang. Overhang undersides
    // should block the player jumping from below, so wall slabs keep their underside.
    const leftJut  = rowBelow !== null ? rowBelow.leftX - row.leftX  : 0;
    const rightJut = rowBelow !== null ? row.rightX - rowBelow.rightX : 0;
    const leftIsOverhang  = leftJut  > 0;
    const rightIsOverhang = rightJut > 0;

    // Wall-base / contraction lip: a walkable, outward-leaning row sitting directly
    // beneath a wall on the same side is the base of that wall (where the heap
    // contracts), not a standalone ramp. The min()-of-segments slope rule can flip
    // such a row to "walkable" off a single shallow downward segment, giving it a
    // solid top that catches a wall-sliding player and refreshes their air jumps.
    // Demote it back to a wall. The row-above test uses the base classification (not
    // this rule), so only the single transition row is demoted — it never cascades
    // down a genuine climbable ramp whose rows are walkable by the base rule.
    const leftIsBaseLip  = leftIsOverhang  && this.sideIsWallByBase(rows, i - 1, 'left');
    const rightIsBaseLip = rightIsOverhang && this.sideIsWallByBase(rows, i - 1, 'right');

    const leftIsWall  = this.sideIsWallByBase(rows, i, 'left')  || leftIsBaseLip;
    const rightIsWall = this.sideIsWallByBase(rows, i, 'right') || rightIsBaseLip;

    return {
      left:  leftIsWall  ? { kind: 'wall', side: 'left',  isOverhang: leftIsOverhang  } : { kind: 'walkable' },
      right: rightIsWall ? { kind: 'wall', side: 'right', isOverhang: rightIsOverhang } : { kind: 'walkable' },
    };
  }

  /**
   * Extract the geometry of the two half-width slabs from a row.
   * Each row produces left and right slabs centered on their respective halves.
   */
  private slabGeometryForRow(row: ScanlineRow): RowGeometry {
    const centerX     = (row.leftX + row.rightX) / 2;
    const spanLeft    = Math.abs(row.leftX  - centerX);
    const spanRight   = Math.abs(row.rightX - centerX);
    return {
      left:  { x: centerX - spanLeft  / 2, w: spanLeft  },
      right: { x: centerX + spanRight / 2, w: spanRight },
    };
  }

  private buildSlabs(
    bandTop: number,
    rows: ScanlineRow[],
    walkableGroup: Phaser.Physics.Arcade.StaticGroup,
    wallGroup: Phaser.Physics.Arcade.StaticGroup,
  ): void {
    this.destroyBand(bandTop);
    const bodies: Phaser.Types.Physics.Arcade.ImageWithStaticBody[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row    = rows[i];
      const cls    = this.classifyRow(rows, i);
      const geom   = this.slabGeometryForRow(row);

      bodies.push(this.createSpan(walkableGroup, wallGroup, geom.left,  row.y, cls.left));
      bodies.push(this.createSpan(walkableGroup, wallGroup, geom.right, row.y, cls.right));
    }

    this.bandBodies.set(bandTop, bodies);
    this.bandRows.set(bandTop, rows);
  }

  private createSpan(
    walkableGroup: Phaser.Physics.Arcade.StaticGroup,
    wallGroup: Phaser.Physics.Arcade.StaticGroup,
    geom: SlabSpan,
    y: number,
    slab: SlabKind,
  ): Phaser.Types.Physics.Arcade.ImageWithStaticBody {
    const group = slab.kind === 'wall' ? wallGroup : walkableGroup;
    const img = group.create(geom.x, y) as Phaser.Types.Physics.Arcade.ImageWithStaticBody;
    img.setVisible(false);
    img.setDisplaySize(geom.w, FLOOR_BODY_HEIGHT);
    // Debug (F2) colours: walkable = green, wall = purple (slide down, sides block),
    // overhang wall = red (also blocks from below so you can't jump up through it).
    img.setDebugBodyColor(
      slab.kind !== 'wall' ? 0x00ff00 : slab.isOverhang ? 0xff0000 : 0xcc33ff,
    );
    img.refreshBody();
    if (slab.kind === 'wall') {
      // No wall is standable: disable the top so you slide down the face rather than
      // landing/catching on slab tops. The side faces (10px wide, 16px vertical overlap
      // between rows) keep you out of the heap — they can't be tunnelled at run speed.
      img.body.checkCollision.up = false;
      // Non-overhang walls also disable the underside so you can jump up past them.
      // Overhang walls keep it: their underside must block you jumping up through them.
      if (!slab.isOverhang) img.body.checkCollision.down = false;
      img.setData('wallSide', slab.side);
    }
    return img;
  }
}
