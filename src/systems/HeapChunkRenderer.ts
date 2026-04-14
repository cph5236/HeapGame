import Phaser from 'phaser';
import { HeapEntry } from '../data/heapTypes';
import { OBJECT_DEFS } from '../data/heapObjectDefs'; // used by addEntry for bounding box calc
import { CHUNK_BAND_HEIGHT, HEAP_FILL_TEXTURE, ENEMY_CULL_DISTANCE } from '../constants';
import { computeBandScanlines, computeBandPolygon, Vertex } from './HeapPolygon';
import { HEAP_TILE_COUNT } from '../data/heapTileUrls';

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

    // Destroy previous visual objects for this band
    const existing = this.chunkObjects.get(bandTop);
    if (existing) {
      existing.maskGraphics.destroy();
      existing.renderTexture.destroy();
      existing.borderGraphics.destroy();
    }

    // --- Mask Graphics ---
    const maskGfx = this.scene.add.graphics();
    maskGfx.setDepth(HEAP_VISUAL_DEPTH);
    maskGfx.fillStyle(0xffffff, 1);
    maskGfx.fillPoints(polygon, true);

    // --- RenderTexture ---
    const rt = this.scene.add.renderTexture(0, bandTop, 960, CHUNK_BAND_HEIGHT);
    rt.setOrigin(0, 0);
    rt.setDepth(HEAP_VISUAL_DEPTH);

    const tileOffsetY = -(bandTop % TEX_H);
    for (let ty = tileOffsetY; ty < CHUNK_BAND_HEIGHT; ty += TEX_H) {
      const worldTile = Math.floor((bandTop + ty) / TEX_H);
      const tileKey = `${HEAP_FILL_TEXTURE}-${worldTile % HEAP_TILE_COUNT}`;
      rt.draw(tileKey, 0, ty);
    }

    rt.setMask(maskGfx.createGeometryMask());

    // --- Border stroke ---
    const borderGfx = this.scene.add.graphics();
    borderGfx.setDepth(HEAP_VISUAL_DEPTH + 1);
    borderGfx.lineStyle(8, 0x6b3a1f, 1);
    borderGfx.strokePoints(polygon, true);

    this.chunkObjects.set(bandTop, { renderTexture: rt, maskGraphics: maskGfx, borderGraphics: borderGfx });
  }
}
