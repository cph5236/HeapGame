import Phaser from 'phaser';
import { HeapEntry } from '../data/heapTypes';
import { OBJECT_DEFS } from '../data/heapObjectDefs'; // used by addEntry for bounding box calc
import { CHUNK_BAND_HEIGHT, HEAP_FILL_TEXTURE, ENEMY_CULL_DISTANCE, WORLD_WIDTH } from '../constants';
import { computeBandScanlines, computeBandPolygon, Vertex } from './HeapPolygon';
import { HEAP_TILE_COUNT } from '../data/heapTileUrls';

/** Composite texture tile height in px — must match the generated PNG height. */
const TEX_H = 1024;

/** Depth for heap visuals — below invisible physics sprites (depth 5). */
const HEAP_VISUAL_DEPTH = 3;

// ── Heap silhouette styling ───────────────────────────────────────────────
// The heap is drawn as a single textured mass per band. To make it read as a
// solid, lit pile (rather than a flat sticker cut-out) we layer, in order:
//   1. a soft dark halo behind the silhouette to ground it against the sky,
//   2. an inner ambient-occlusion shadow that hugs the silhouette rim,
//   3. a two-tone beveled outline, and
//   4. a warm rim light on up-facing edges.
// Crucially, all of these trace only the *silhouette* (left/right) edges — the
// horizontal edges where a band is cut at its top/bottom boundary are skipped,
// so vertically-adjacent bands blend seamlessly with no horizontal seam line.

/** Outer grounding halo: soft dark glow cast outward from the silhouette. */
const HEAP_HALO_COLOR  = 'rgba(0,0,0,0.45)';
const HEAP_HALO_BLUR   = 12;

/** Inner ambient occlusion: [strokeWidth, alpha] passes, widest/faintest first. */
const HEAP_AO_PASSES: ReadonlyArray<readonly [number, number]> = [
  [44, 0.06], [30, 0.08], [18, 0.11], [10, 0.15], [5, 0.22],
];
const HEAP_AO_COLOR = '8,6,3';

/** Two-tone beveled outline: a dark base with a warmer brown sitting inside it. */
const HEAP_OUTLINE_DARK   = '#241307';
const HEAP_OUTLINE_DARK_W = 8;
const HEAP_OUTLINE_WARM   = '#7c4a23';
const HEAP_OUTLINE_WARM_W = 4;

/** Rim light on up-facing edges (outward normal y below -threshold). */
const HEAP_RIM_COLOR  = '235,208,162';
const HEAP_RIM_ALPHA  = 0.8;
const HEAP_RIM_WIDTH  = 2.6;
const HEAP_RIM_THRESH = 0.3;

/** Local-space 2D point used while baking a chunk. */
interface LocalPt { x: number; y: number; }

interface ChunkObjects {
  image:      Phaser.GameObjects.Image;
  textureKey: string;
}

export class HeapChunkRenderer {
  private readonly scene: Phaser.Scene;
  private readonly xOffset: number;
  private readonly colWidth: number;

  /** entries bucketed by bandTop — an entry may appear in up to 2 buckets if it crosses a boundary. */
  private readonly buckets: Map<number, HeapEntry[]> = new Map();

  /** Live Phaser objects per rendered chunk, keyed by bandTop. */
  private readonly chunkObjects: Map<number, ChunkObjects> = new Map();

  /** Monotonic counter for unique texture keys (avoids collision when a chunk re-renders). */
  private static _textureSeq = 0;

  constructor(scene: Phaser.Scene, xOffset = 0, colWidth = WORLD_WIDTH) {
    this.scene    = scene;
    this.xOffset  = xOffset;
    this.colWidth = colWidth;
  }

  /**
   * Register an entry in the internal buckets WITHOUT triggering a re-render.
   * Used by the worker path so that later addEntry() calls see all previous entries
   * when they recompute the polygon for a band.
   */
  registerEntry(entry: HeapEntry): void {
    const def = OBJECT_DEFS[entry.keyid] ?? OBJECT_DEFS[0];
    const entryTop    = entry.y - def.height / 2;
    const entryBottom = entry.y + def.height / 2;
    const firstBand = Math.floor(entryTop    / CHUNK_BAND_HEIGHT) * CHUNK_BAND_HEIGHT;
    const lastBand  = Math.floor(entryBottom / CHUNK_BAND_HEIGHT) * CHUNK_BAND_HEIGHT;
    for (let band = firstBand; band <= lastBand; band += CHUNK_BAND_HEIGHT) {
      let bucket = this.buckets.get(band);
      if (!bucket) { bucket = []; this.buckets.set(band, bucket); }
      bucket.push(entry);
    }
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
        this.disposeChunk(objs);
        this.chunkObjects.delete(bandTop);
      }
    }
  }

  private disposeChunk(objs: ChunkObjects): void {
    objs.image.destroy();
    if (this.scene.textures.exists(objs.textureKey)) {
      this.scene.textures.remove(objs.textureKey);
    }
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private renderChunk(bandTop: number): void {
    const bandBottom = bandTop + CHUNK_BAND_HEIGHT;
    const entries = this.buckets.get(bandTop);
    if (!entries || entries.length === 0) return;

    const rows = computeBandScanlines(entries, bandTop, bandBottom);
    const polygon = computeBandPolygon(rows);
    this.renderPolygon(bandTop, polygon);
  }

  /**
   * Render a chunk from a pre-computed polygon (e.g. received from the server).
   * Skips scanline computation — takes vertices directly.
   */
  renderFromPolygon(bandTop: number, polygon: Vertex[]): void {
    this.renderPolygon(bandTop, polygon);
  }

  private renderPolygon(bandTop: number, polygon: Vertex[]): void {
    if (polygon.length < 3) return;

    // Destroy previous visual objects for this band (e.g. when an entry is added
    // that mutates an existing chunk's polygon).
    const existing = this.chunkObjects.get(bandTop);
    if (existing) {
      this.disposeChunk(existing);
    }

    // Bake fill + shading + outline into a single canvas via canvas2d's native
    // path rasterizer (no JS earcut, no per-frame BitmapMask). Result is a
    // single textured quad rendered through the standard ImageWebGLRenderer path.
    const W = this.colWidth;
    const H = CHUNK_BAND_HEIGHT;
    const canvas = document.createElement('canvas');
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Translate the polygon from world space into local (canvas) space.
    const pts: LocalPt[] = polygon.map(p => ({ x: p.x - this.xOffset, y: p.y - bandTop }));

    // Silhouette = contiguous runs of edges that are NOT the horizontal
    // band-boundary connectors (top edge at y≈0, bottom edge at y≈H). Shading
    // and outlines trace only these, so adjacent bands meet without a seam.
    const runs = HeapChunkRenderer.silhouetteRuns(pts, H);

    const tracePath = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
    };
    const strokeRuns = (width: number, style: string) => {
      ctx.lineJoin = 'round';
      ctx.lineCap  = 'round';
      ctx.lineWidth   = width;
      ctx.strokeStyle = style;
      for (const run of runs) {
        ctx.beginPath();
        ctx.moveTo(run[0].x, run[0].y);
        for (let i = 1; i < run.length; i++) ctx.lineTo(run[i].x, run[i].y);
        ctx.stroke();
      }
    };

    // 1. Soft grounding halo — a blurred dark glow around the silhouette that
    //    sits behind the fill, separating the heap from the sky.
    ctx.save();
    ctx.shadowColor = HEAP_HALO_COLOR;
    ctx.shadowBlur  = HEAP_HALO_BLUR;
    strokeRuns(2, 'rgba(25,15,8,1)');
    ctx.restore();

    // 2. Fill: clip to the polygon, draw the tiled heap texture, then layer the
    //    inner ambient-occlusion shadow (clipped, so it darkens only the rim).
    ctx.save();
    tracePath();
    ctx.clip();
    const tileOffsetY = -(bandTop % TEX_H);
    for (let ty = tileOffsetY; ty < H; ty += TEX_H) {
      const worldTile = Math.floor((bandTop + ty) / TEX_H);
      const tileKey   = `${HEAP_FILL_TEXTURE}-${worldTile % HEAP_TILE_COUNT}`;
      const tileSrc   = this.scene.textures.get(tileKey).getSourceImage() as CanvasImageSource;
      ctx.drawImage(tileSrc, 0, ty);
    }
    for (const [w, a] of HEAP_AO_PASSES) strokeRuns(w, `rgba(${HEAP_AO_COLOR},${a})`);
    ctx.restore();

    // 3. Two-tone beveled outline on the silhouette (dark base, warm inner).
    strokeRuns(HEAP_OUTLINE_DARK_W, HEAP_OUTLINE_DARK);
    strokeRuns(HEAP_OUTLINE_WARM_W, HEAP_OUTLINE_WARM);

    // 4. Warm rim light on up-facing edges — simulates sky light on the pile.
    HeapChunkRenderer.strokeRimLight(ctx, pts, runs);

    const textureKey = `chunk-${++HeapChunkRenderer._textureSeq}`;
    this.scene.textures.addCanvas(textureKey, canvas);

    const image = this.scene.add
      .image(this.xOffset, bandTop, textureKey)
      .setOrigin(0, 0)
      .setDepth(HEAP_VISUAL_DEPTH);

    this.chunkObjects.set(bandTop, { image, textureKey });
  }

  /**
   * Split a band polygon into contiguous silhouette runs, dropping the
   * horizontal connector edges that lie along the band's top (y≈0) or bottom
   * (y≈H) cut line. These connectors are internal boundaries shared with the
   * neighbouring band, so leaving them un-stroked makes stacked bands blend.
   */
  private static silhouetteRuns(pts: LocalPt[], H: number): LocalPt[][] {
    const eps = 2;
    const isConnector = (a: LocalPt, b: LocalPt): boolean =>
      (Math.abs(a.y)     <= eps && Math.abs(b.y)     <= eps) ||
      (Math.abs(a.y - H) <= eps && Math.abs(b.y - H) <= eps);

    const runs: LocalPt[][] = [];
    let cur: LocalPt[] | null = null;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      if (isConnector(a, b)) {
        if (cur) { runs.push(cur); cur = null; }
        continue;
      }
      if (!cur) cur = [a];
      cur.push(b);
    }
    if (cur) runs.push(cur);
    return runs;
  }

  /** Stroke a warm highlight on edges whose outward normal faces upward. */
  private static strokeRimLight(
    ctx: CanvasRenderingContext2D,
    pts: LocalPt[],
    runs: LocalPt[][],
  ): void {
    ctx.lineCap   = 'round';
    ctx.lineWidth = HEAP_RIM_WIDTH;
    for (const run of runs) {
      for (let i = 0; i < run.length - 1; i++) {
        const a = run[i];
        const b = run[i + 1];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        // Outward normal: pick the candidate that points out of the polygon.
        let nx = dy;
        let ny = -dx;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        if (HeapChunkRenderer.pointInPolygon(pts, mx + nx * 3, my + ny * 3)) {
          nx = -nx; ny = -ny;
        }
        if (ny < -HEAP_RIM_THRESH) {
          const strength = Math.min(1, (-ny - HEAP_RIM_THRESH) / (1 - HEAP_RIM_THRESH));
          ctx.strokeStyle = `rgba(${HEAP_RIM_COLOR},${HEAP_RIM_ALPHA * strength})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
  }

  /** Standard even-odd ray-cast point-in-polygon test. */
  private static pointInPolygon(pts: LocalPt[], x: number, y: number): boolean {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x, yi = pts[i].y;
      const xj = pts[j].x, yj = pts[j].y;
      if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }
}
