import Phaser from 'phaser';
import { HeapEntry } from '../data/heapTypes';
import { CHUNK_BAND_HEIGHT } from '../constants';
import { computeBandScanlines, computeBandPolygon, ScanlineRow, Vertex } from './HeapPolygon';

/** Size of each square collider body placed along polygon edges. */
const BODY_SIZE = 8;

/**
 * Manages static-body rectangles placed along the polygon boundary of each
 * heap chunk band. Bodies are placed directly on the polygon vertices that
 * define the visual outline, so physics collision matches the render exactly.
 *
 * Two input paths:
 *  - `buildFromScanlines()` — local path, converts scanlines → polygon → bodies
 *  - `buildFromVertices()`  — server path, takes a pre-computed closed polygon
 */
export class HeapEdgeCollider {
  /** Edge bodies per band, keyed by bandTop. */
  private readonly bandBodies: Map<number, Phaser.Physics.Arcade.Image[]> = new Map();

  constructor(_scene: Phaser.Scene) {}

  // ── Local path ────────────────────────────────────────────────────────────

  buildFromScanlines(
    bandTop: number,
    rows: ScanlineRow[],
    group: Phaser.Physics.Arcade.StaticGroup,
  ): void {
    if (rows.length === 0) { this.destroyBand(bandTop); return; }
    this.buildAlongEdges(bandTop, computeBandPolygon(rows), group);
  }

  // ── Server path ───────────────────────────────────────────────────────────

  buildFromVertices(
    bandTop: number,
    vertices: Vertex[],
    group: Phaser.Physics.Arcade.StaticGroup,
  ): void {
    this.buildAlongEdges(bandTop, vertices, group);
  }

  // ── Convenience: rebuild a band from raw entries ──────────────────────────

  rebuildBand(
    bandTop: number,
    entries: HeapEntry[],
    group: Phaser.Physics.Arcade.StaticGroup,
  ): void {
    const rows = computeBandScanlines(entries, bandTop, bandTop + CHUNK_BAND_HEIGHT);
    this.buildFromScanlines(bandTop, rows, group);
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

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

  // ── Core: walk polygon edges and tile with small square bodies ────────────

  private buildAlongEdges(
    bandTop: number,
    vertices: Vertex[],
    group: Phaser.Physics.Arcade.StaticGroup,
  ): void {
    this.destroyBand(bandTop);
    if (vertices.length < 3) return;

    const bodies: Phaser.Physics.Arcade.Image[] = [];
    const n = vertices.length;

    for (let i = 0; i < n; i++) {
      const a = vertices[i];
      const b = vertices[(i + 1) % n];

      // Cover the corner vertex itself — midpoint bodies leave an ~8px gap at each corner
      bodies.push(this.createBody(group, a.x, a.y));

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1) continue;

      const steps = Math.max(1, Math.ceil(len / BODY_SIZE));
      for (let j = 0; j < steps; j++) {
        const t = (j + 0.5) / steps;
        bodies.push(this.createBody(group, a.x + dx * t, a.y + dy * t));
      }
    }

    this.bandBodies.set(bandTop, bodies);
  }

  private createBody(
    group: Phaser.Physics.Arcade.StaticGroup,
    x: number,
    y: number,
  ): Phaser.Physics.Arcade.Image {
    const img = group.create(x, y) as Phaser.Types.Physics.Arcade.ImageWithStaticBody;
    img.setVisible(false);
    // setDisplaySize before refreshBody — StaticBody.reset() reads displayWidth/displayHeight,
    // so it must be set first. Calling setSize() after refreshBody() would be overwritten.
    img.setDisplaySize(BODY_SIZE, BODY_SIZE);
    img.refreshBody();
    return img as unknown as Phaser.Physics.Arcade.Image;
  }
}
