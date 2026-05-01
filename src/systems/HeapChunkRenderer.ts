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

    // Bake fill + border into a single canvas via canvas2d's native path
    // rasterizer (no JS earcut, no per-frame BitmapMask). Result is a single
    // textured quad rendered through the standard ImageWebGLRenderer path.
    const W = this.colWidth;
    const H = CHUNK_BAND_HEIGHT;
    const canvas = document.createElement('canvas');
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Build the polygon path once — used for both clip() and stroke().
    // Polygon is translated from world space into local (canvas) space.
    ctx.beginPath();
    ctx.moveTo(polygon[0].x - this.xOffset, polygon[0].y - bandTop);
    for (let i = 1; i < polygon.length; i++) {
      ctx.lineTo(polygon[i].x - this.xOffset, polygon[i].y - bandTop);
    }
    ctx.closePath();

    // Clip to polygon, draw the heap-fill tiles, restore.
    ctx.save();
    ctx.clip();
    const tileOffsetY = -(bandTop % TEX_H);
    for (let ty = tileOffsetY; ty < H; ty += TEX_H) {
      const worldTile = Math.floor((bandTop + ty) / TEX_H);
      const tileKey   = `${HEAP_FILL_TEXTURE}-${worldTile % HEAP_TILE_COUNT}`;
      const tileSrc   = this.scene.textures.get(tileKey).getSourceImage() as CanvasImageSource;
      ctx.drawImage(tileSrc, 0, ty);
    }
    ctx.restore();

    // Stroke the border on top (after restore so the line can sit on the
    // polygon edge — same visual as the prior borderGfx layer).
    ctx.lineWidth   = 8;
    ctx.strokeStyle = '#6b3a1f';
    ctx.stroke();

    const textureKey = `chunk-${++HeapChunkRenderer._textureSeq}`;
    this.scene.textures.addCanvas(textureKey, canvas);

    const image = this.scene.add
      .image(this.xOffset, bandTop, textureKey)
      .setOrigin(0, 0)
      .setDepth(HEAP_VISUAL_DEPTH);

    this.chunkObjects.set(bandTop, { image, textureKey });
  }
}
