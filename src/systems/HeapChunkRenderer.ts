import Phaser from 'phaser';
import { HeapEntry } from '../data/heapTypes';
import { OBJECT_DEFS } from '../data/heapObjectDefs';
import { CHUNK_BAND_HEIGHT, HEAP_FILL_TEXTURE, ENEMY_CULL_DISTANCE } from '../constants';

/** Y-resolution of the silhouette scanline in world pixels. */
const SCAN_STEP = 4;

/** Sliding-window size for edge smoothing (number of scanlines). Odd for symmetry. */
const SMOOTH_WINDOW = 7;

/** Composite texture tile height in px — must match the generated PNG height. */
const TEX_H = 1024;

/** Depth for heap visuals — below invisible physics sprites (depth 5). */
const HEAP_VISUAL_DEPTH = 3;

interface ChunkObjects {
  renderTexture: Phaser.GameObjects.RenderTexture;
  maskGraphics: Phaser.GameObjects.Graphics;
  borderGraphics: Phaser.GameObjects.Graphics;
}

export class HeapChunkRenderer {
  private readonly scene: Phaser.Scene;

  /** entries bucketed by bandTop — an entry may appear in up to 2 buckets if it crosses a boundary. */
  private readonly buckets: Map<number, HeapEntry[]> = new Map();

  /** Live Phaser objects per rendered chunk, keyed by bandTop. */
  private readonly chunkObjects: Map<number, ChunkObjects> = new Map();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** Register a new heap entry and redraw its chunk(s). */
  addEntry(entry: HeapEntry): void {
    const def = OBJECT_DEFS[entry.keyid] ?? OBJECT_DEFS[0];
    const entryTop    = entry.y - def.height / 2;
    const entryBottom = entry.y + def.height / 2;

    // Find all bands this entry's bounding box overlaps
    const firstBand = Math.floor(entryTop    / CHUNK_BAND_HEIGHT) * CHUNK_BAND_HEIGHT;
    const lastBand  = Math.floor(entryBottom / CHUNK_BAND_HEIGHT) * CHUNK_BAND_HEIGHT;

    for (let band = firstBand; band <= lastBand; band += CHUNK_BAND_HEIGHT) {
      let bucket = this.buckets.get(band);
      if (!bucket) {
        bucket = [];
        this.buckets.set(band, bucket);
      }
      bucket.push(entry);
      this.renderChunk(band);
    }
  }

  /**
   * Destroy rendered objects for chunks that have scrolled far below the camera.
   * Call from GameScene.update() every frame.
   */
  cullChunks(camBottom: number): void {
    const cullThreshold = camBottom + ENEMY_CULL_DISTANCE;
    for (const [bandTop, objs] of this.chunkObjects) {
      if (bandTop > cullThreshold) {
        objs.maskGraphics.destroy();
        objs.renderTexture.destroy();
        objs.borderGraphics.destroy();
        this.chunkObjects.delete(bandTop);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private renderChunk(bandTop: number): void {
    const bandBottom = bandTop + CHUNK_BAND_HEIGHT;
    const entries = this.buckets.get(bandTop);
    if (!entries || entries.length === 0) return;

    // Destroy previous visual objects for this band
    const existing = this.chunkObjects.get(bandTop);
    if (existing) {
      existing.maskGraphics.destroy();
      existing.renderTexture.destroy();
      existing.borderGraphics.destroy();
    }

    const polygon = this.buildSilhouette(entries, bandTop, bandBottom);
    if (polygon.length < 3) return;

    // --- Mask Graphics ---
    // Draws the silhouette polygon in world coordinates; used as geometry mask.
    const maskGfx = this.scene.add.graphics();
    maskGfx.setDepth(HEAP_VISUAL_DEPTH);
    maskGfx.fillStyle(0xffffff, 1);
    maskGfx.fillPoints(polygon, true);

    // --- RenderTexture ---
    // Tiles composite-heap.png over the band area, clipped by the mask.
    const rt = this.scene.add.renderTexture(0, bandTop, 960, CHUNK_BAND_HEIGHT);
    rt.setOrigin(0, 0);
    rt.setDepth(HEAP_VISUAL_DEPTH);

    // Tile the composite texture so the tiling offset aligns with world Y
    const tileOffsetY = -(bandTop % TEX_H);
    for (let ty = tileOffsetY; ty < CHUNK_BAND_HEIGHT; ty += TEX_H) {
      rt.draw(HEAP_FILL_TEXTURE, 0, ty);
    }

    // Apply geometry mask
    rt.setMask(maskGfx.createGeometryMask());

    // --- Border stroke ---
    const borderGfx = this.scene.add.graphics();
    borderGfx.setDepth(HEAP_VISUAL_DEPTH + 1);
    borderGfx.lineStyle(8, 0x6b3a1f, 1);
    borderGfx.strokePoints(polygon, true);

    this.chunkObjects.set(bandTop, { renderTexture: rt, maskGraphics: maskGfx, borderGraphics: borderGfx });
  }

  /**
   * Compute a smoothed silhouette polygon for the given entries within [bandTop, bandBottom].
   * Returns an array of world-space points suitable for fillPoints().
   */
  private buildSilhouette(
    entries: HeapEntry[],
    bandTop: number,
    bandBottom: number,
  ): Phaser.Types.Math.Vector2Like[] {
    // Pre-compute bounding rects
    const rects = entries.map(e => {
      const def = OBJECT_DEFS[e.keyid] ?? OBJECT_DEFS[0];
      return {
        left:   e.x - def.width  / 2,
        right:  e.x + def.width  / 2,
        top:    e.y - def.height / 2,
        bottom: e.y + def.height / 2,
      };
    });

    // Scanline: collect leftmost and rightmost X per row
    const rows: { y: number; left: number; right: number }[] = [];
    let lastLeft  = 480; // world center as fallback
    let lastRight = 480;

    for (let y = bandTop; y <= bandBottom; y += SCAN_STEP) {
      let minX =  Infinity;
      let maxX = -Infinity;
      for (const r of rects) {
        if (y >= r.top && y <= r.bottom) {
          if (r.left  < minX) minX = r.left;
          if (r.right > maxX) maxX = r.right;
        }
      }
      if (minX !== Infinity) {
        lastLeft  = minX;
        lastRight = maxX;
        rows.push({ y, left: minX, right: maxX });
      } else if (rows.length > 0) {
        // Forward-fill so the polygon stays continuous inside the band
        rows.push({ y, left: lastLeft, right: lastRight });
      }
    }

    if (rows.length < 2) return [];

    // Backward-fill: if the first entry doesn't start at bandTop, extend the
    // silhouette up to bandTop using the first row's left/right values.
    // This ensures the pile looks solid from the top of each band downward.
    if (rows[0].y > bandTop) {
      const firstLeft  = rows[0].left;
      const firstRight = rows[0].right;
      const backfill: typeof rows = [];
      for (let y = bandTop; y < rows[0].y; y += SCAN_STEP) {
        backfill.push({ y, left: firstLeft, right: firstRight });
      }
      rows.unshift(...backfill);
    }

    // Smooth left and right edges with a sliding-window average
    const smooth = (vals: number[]): number[] => {
      const half = Math.floor(SMOOTH_WINDOW / 2);
      return vals.map((_, i) => {
        let sum = 0, count = 0;
        for (let k = i - half; k <= i + half; k++) {
          if (k >= 0 && k < vals.length) { sum += vals[k]; count++; }
        }
        return sum / count;
      });
    };

    const leftSmooth  = smooth(rows.map(r => r.left));
    const rightSmooth = smooth(rows.map(r => r.right));

    // Build polygon: left edge top→bottom, right edge bottom→top
    const points: Phaser.Types.Math.Vector2Like[] = [];

    for (let i = 0; i < rows.length; i++) {
      points.push({ x: leftSmooth[i], y: rows[i].y });
    }
    for (let i = rows.length - 1; i >= 0; i--) {
      points.push({ x: rightSmooth[i], y: rows[i].y });
    }

    return points;
  }
}
