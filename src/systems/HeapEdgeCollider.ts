import Phaser from 'phaser';
import { HeapEntry } from '../data/heapTypes';
import { CHUNK_BAND_HEIGHT } from '../constants';
import { computeBandScanlines, ScanlineRow, SCAN_STEP, Vertex } from './HeapPolygon';

/** Thickness of each edge collider body in pixels. */
const EDGE_THICKNESS = 3;

/** How far inward (into the heap) to shift collider centers, so they sit under the brown stroke. */
const COLLIDER_INSET_HORIZONTAL = 12;
const COLLIDER_INSET_DIAGONAL = 4;

/**
 * Manages thin static-body rectangles placed along the polygon boundary of each
 * heap chunk band, replacing per-entry AABB Platform bodies with a contour collider.
 *
 * Two input paths:
 *  - `buildFromScanlines()` — local path, takes scanline rows computed from HeapEntry data
 *  - `buildFromVertices()`  — server path, takes a pre-computed closed polygon
 */
export class HeapEdgeCollider {
  /** Edge bodies per band, keyed by bandTop. */
  private readonly bandBodies: Map<number, Phaser.Physics.Arcade.Image[]> = new Map();

  constructor(_scene: Phaser.Scene) {
    // scene kept in signature for future use (e.g. debug drawing)
  }

  // ── Local path: build from scanline rows ──────────────────────────────────

  /**
   * Create edge collider bodies for a band from scanline data.
   * Destroys any previous bodies for this band first.
   */
  buildFromScanlines(
    bandTop: number,
    rows: ScanlineRow[],
    group: Phaser.Physics.Arcade.StaticGroup,
  ): void {
    this.destroyBand(bandTop);
    if (rows.length === 0) return;

    const bodies: Phaser.Physics.Arcade.Image[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const nextRow = rows[i + 1];
      const stepH = nextRow ? (nextRow.y - row.y) : SCAN_STEP;

      // Left edge — detect diagonal vs vertical
      const dxL = nextRow ? (nextRow.leftX - row.leftX) : 0;
      if (Math.abs(dxL) > EDGE_THICKNESS) {
        // Diagonal: chain of small square bodies along the line
        const steps = Math.ceil(Math.abs(dxL) / EDGE_THICKNESS);
        for (let j = 0; j < steps; j++) {
          const t = (j + 0.5) / steps;
          bodies.push(this.createEdgeBody(
            group,
            row.leftX - (1 * t + COLLIDER_INSET_DIAGONAL),
            row.y + stepH * t ,
            EDGE_THICKNESS, EDGE_THICKNESS,
          ));
        }
      } else {
        // Vertical: one tall thin body
        bodies.push(this.createEdgeBody(
          group, row.leftX + COLLIDER_INSET_HORIZONTAL, row.y + stepH / 2,
          EDGE_THICKNESS, stepH + 2,
        ));
      }

      // Right edge — mirror logic
      const dxR = nextRow ? (nextRow.rightX - row.rightX) : 0;
      if (Math.abs(dxR) > EDGE_THICKNESS) {        
        const steps = Math.ceil(Math.abs(dxR) / EDGE_THICKNESS);
        for (let j = 0; j < steps; j++) {
          var diagnalYOffset = 2*dxR;
          var diagnalXOffset = -10;
          if(dxR < 0) { // Diagonal slanting rightward — inset diagonally
            diagnalYOffset = diagnalYOffset * -1;
            diagnalXOffset = diagnalXOffset * -1;
          }
          const t = (j + 0.5) / steps;
          bodies.push(this.createEdgeBody(
            group,
            row.rightX + (1 * t) - COLLIDER_INSET_DIAGONAL - diagnalXOffset,
            row.y + stepH * t + diagnalYOffset,
            EDGE_THICKNESS, EDGE_THICKNESS,
          ));
        }
      } else {
        bodies.push(this.createEdgeBody(
          group, row.rightX - COLLIDER_INSET_HORIZONTAL, row.y + stepH / 2,
          EDGE_THICKNESS, stepH + 2,
        ));
      }
    }

    // Top cap — horizontal surface at the topmost scanline row, inset downward
    const topRow = rows[0];
    const capWidth = topRow.rightX - topRow.leftX - 2 * COLLIDER_INSET_HORIZONTAL;
    if (capWidth > 0) {
      bodies.push(this.createEdgeBody(
        group,
        topRow.leftX + COLLIDER_INSET_HORIZONTAL  + capWidth / 2, topRow.y + COLLIDER_INSET_HORIZONTAL,
        capWidth, EDGE_THICKNESS,
      ));
    }
    this.bandBodies.set(bandTop, bodies);
  }

  // ── Server path: build from a closed vertex polygon ───────────────────────

  /**
   * Create edge collider bodies from a pre-computed closed polygon.
   * Converts the polygon back to left/right edge pairs, then delegates to
   * scanline-based creation.
   */
  buildFromVertices(
    bandTop: number,
    vertices: Vertex[],
    group: Phaser.Physics.Arcade.StaticGroup,
  ): void {
    const rows = verticesToScanlines(vertices);
    this.buildFromScanlines(bandTop, rows, group);
  }

  // ── Convenience: rebuild a band from raw entries ──────────────────────────

  /**
   * Recompute scanlines from entries and rebuild edge bodies for a band.
   */
  rebuildBand(
    bandTop: number,
    entries: HeapEntry[],
    group: Phaser.Physics.Arcade.StaticGroup,
  ): void {
    const bandBottom = bandTop + CHUNK_BAND_HEIGHT;
    const rows = computeBandScanlines(entries, bandTop, bandBottom);
    this.buildFromScanlines(bandTop, rows, group);
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  /** Destroy all edge bodies for a band. */
  destroyBand(bandTop: number): void {
    const bodies = this.bandBodies.get(bandTop);
    if (bodies) {
      for (const body of bodies) body.destroy();
      this.bandBodies.delete(bandTop);
    }
  }

  /** Destroy edge bodies for bands that have scrolled far below the camera. */
  cullBands(camBottom: number, cullDistance: number): void {
    const threshold = camBottom + cullDistance;
    for (const [bandTop] of this.bandBodies) {
      if (bandTop > threshold) {
        this.destroyBand(bandTop);
      }
    }
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private createEdgeBody(
    group: Phaser.Physics.Arcade.StaticGroup,
    x: number,
    y: number,
    width: number,
    height: number,
  ): Phaser.Physics.Arcade.Image {
    // Use an invisible image in the static group — no texture needed
    const img = group.create(x, y) as Phaser.Physics.Arcade.Image;
    img.setVisible(false);
    img.body!.setSize(width, height);
    img.body!.setOffset(-width / 2, -height / 2);
    (img as Phaser.Types.Physics.Arcade.ImageWithStaticBody).refreshBody();
    return img;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convert a closed polygon (left edge top→bottom, right edge bottom→top)
 * back into scanline rows. Assumes the polygon was produced by computeBandPolygon().
 */
function verticesToScanlines(vertices: Vertex[]): ScanlineRow[] {
  if (vertices.length < 4) return [];

  // The polygon has N left-edge points followed by N right-edge points (reversed).
  // Detect the midpoint: the Y values ascend in the left half and descend in the right half.
  const half = vertices.length / 2;
  const rows: ScanlineRow[] = [];

  for (let i = 0; i < half; i++) {
    const left  = vertices[i];
    const right = vertices[vertices.length - 1 - i];
    rows.push({ y: left.y, leftX: left.x, rightX: right.x });
  }

  return rows;
}
