import Phaser from 'phaser';
import { HeapEntry } from '../data/heapTypes';
import { OBJECT_DEFS } from '../data/heapObjectDefs';
import { CHUNK_BAND_HEIGHT, MOCK_HEAP_HEIGHT_PX } from '../constants';
import { HeapChunkRenderer } from './HeapChunkRenderer';
import { HeapEdgeCollider } from './HeapEdgeCollider';
import { Vertex } from './HeapPolygon';
import type { WorkerBandInput, WorkerRequest, WorkerResponse } from '../workers/heapWorker';

export class HeapGenerator {
  private readonly walkableGroup: Phaser.Physics.Arcade.StaticGroup;
  private readonly wallGroup:     Phaser.Physics.Arcade.StaticGroup;
  private readonly chunkRenderer?: HeapChunkRenderer;
  private readonly edgeCollider?: HeapEdgeCollider;

  onPlatformSpawned?: (entry: HeapEntry, platformTopY: number) => void;
  onBandLoaded?: (bandTopY: number, vertices: Vertex[]) => void;

  // Data sorted by Y descending (highest Y = bottom of heap = index 0).
  private readonly data: HeapEntry[];

  // Pointer into data[]. Everything before this index has been fully flushed.
  private nextLoadIndex: number = 0;

  // How many entries have been sent to the worker but not yet flushed to Phaser.
  private sentCount: number = 0;

  // Track which bands need edge collider rebuilds during sync generation
  private readonly dirtyBands: Set<number> = new Set();

  // Entry buckets used for edge collider rebuilds in sync path + addEntry()
  private readonly entryBuckets: Map<number, HeapEntry[]> = new Map();

  /** Set by GameScene when using the server polygon path. Overrides entry-based topY. */
  private _polygonTopY: number | null = null;

  // ── Worker state ────────────────────────────────────────────────────────────

  private readonly worker: Worker;
  private workerBusy = false;
  /** Latest toY request that arrived while the worker was busy. Latest-wins. */
  private pendingToY: number | null = null;
  /** Band results from the worker waiting to be applied to Phaser on the main thread. */
  private pendingBandResults: WorkerResponse[] = [];

  constructor(
    _scene: Phaser.Scene,
    walkableGroup: Phaser.Physics.Arcade.StaticGroup,
    wallGroup: Phaser.Physics.Arcade.StaticGroup,
    data: HeapEntry[],
    chunkRenderer?: HeapChunkRenderer,
    edgeCollider?: HeapEdgeCollider,
  ) {
    this.walkableGroup = walkableGroup;
    this.wallGroup     = wallGroup;
    this.chunkRenderer = chunkRenderer;
    this.edgeCollider = edgeCollider;
    // Sort defensively in case caller passes unsorted data
    this.data = [...data].sort((a, b) => b.y - a.y);

    this.worker = new Worker(
      new URL('../workers/heapWorker.ts', import.meta.url),
      { type: 'module' },
    );

    this.worker.onmessage = (e: MessageEvent<WorkerResponse>): void => {
      this.pendingBandResults.push(e.data);
      this.workerBusy = false;
      // Immediately dispatch a queued request if one arrived while we were busy
      if (this.pendingToY !== null) {
        const toY = this.pendingToY;
        this.pendingToY = null;
        this._sendBatch(toY);
      }
    };
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /** Live read-only view of all entries — used by findSurfaceY at runtime. */
  get entries(): readonly HeapEntry[] {
    return this.data;
  }

  /**
   * Y of the heap's topmost surface (smallest top-edge Y across all entries).
   * Used to define the player placement zone.
   */
  get topY(): number {
    if (this._polygonTopY !== null) return this._polygonTopY;
    let min = MOCK_HEAP_HEIGHT_PX;
    for (const e of this.data) {
      const def = OBJECT_DEFS[e.keyid] ?? OBJECT_DEFS[0];
      const top = e.y - def.height / 2;
      if (top < min) min = top;
    }
    return min;
  }

  /** Override topY for server polygon path (no entries to compute from). */
  setPolygonTopY(y: number): void {
    this._polygonTopY = y;
  }

  /**
   * Synchronous generation — runs entirely on the main thread.
   * Use this for the initial world setup in create() so collision is ready
   * before the first frame renders.
   */
  generateUpToSync(toY: number): void {
    this.dirtyBands.clear();

    while (
      this.nextLoadIndex < this.data.length &&
      this.data[this.nextLoadIndex].y >= toY
    ) {
      this.spawnEntry(this.data[this.nextLoadIndex]);
      this.nextLoadIndex++;
    }
    // Also advance sentCount to match so the worker path starts from the right place
    this.sentCount = this.nextLoadIndex;

    // Batch-rebuild edge colliders for all bands that received new entries
    if (this.edgeCollider && this.dirtyBands.size > 0) {
      for (const bandTop of this.dirtyBands) {
        const bucket = this.entryBuckets.get(bandTop);
        if (bucket) {
          this.edgeCollider.rebuildBand(bandTop, bucket, this.walkableGroup, this.wallGroup);
        }
      }
      this.dirtyBands.clear();
    }
  }

  /**
   * Async generation — sends the qualifying entry slice to the Web Worker.
   * Phaser objects are created lazily in flushWorkerResults() each frame.
   * Call generateUpToSync() for the initial setup before using this.
   */
  generateUpTo(toY: number): void {
    if (this.workerBusy) {
      this.pendingToY = toY;
      return;
    }
    this._sendBatch(toY);
  }

  /**
   * Apply pending worker results to Phaser objects.
   * Call this once per frame from GameScene.update(), after generateUpTo().
   */
  flushWorkerResults(): void {
    if (this.pendingBandResults.length === 0) return;

    for (const response of this.pendingBandResults) {
      // Apply visuals + colliders for each computed band
      for (const band of response.bands) {
        this.applyBandPolygon(band.bandTop, band.polygon);
      }

      // Register each entry in chunkRenderer's buckets (keeps them accurate for
      // future addEntry() calls that re-render a band from scratch)
      for (const entry of response.entries) {
        this.chunkRenderer?.registerEntry(entry as HeapEntry);
      }

      // Update entryBuckets so addEntry() has full history when it rebuilds a band
      for (const entry of response.entries) {
        const he = entry as HeapEntry;
        const def = OBJECT_DEFS[he.keyid] ?? OBJECT_DEFS[0];
        const top    = he.y - def.height / 2;
        const bottom = he.y + def.height / 2;
        const firstBand = Math.floor(top    / CHUNK_BAND_HEIGHT) * CHUNK_BAND_HEIGHT;
        const lastBand  = Math.floor(bottom / CHUNK_BAND_HEIGHT) * CHUNK_BAND_HEIGHT;
        for (let band = firstBand; band <= lastBand; band += CHUNK_BAND_HEIGHT) {
          let bucket = this.entryBuckets.get(band);
          if (!bucket) { bucket = []; this.entryBuckets.set(band, bucket); }
          bucket.push(he);
        }
      }

      // Fire onPlatformSpawned once per entry (enemies, etc.)
      for (const entry of response.entries) {
        const he = entry as HeapEntry;
        const def = OBJECT_DEFS[he.keyid] ?? OBJECT_DEFS[0];
        const platformTopY = he.y - def.height / 2;
        this.onPlatformSpawned?.(he, platformTopY);
      }

      this.nextLoadIndex += response.processedCount;
    }

    this.pendingBandResults = [];
    // sentCount stays ahead of nextLoadIndex until flushed; keep them in sync now
    this.sentCount = this.nextLoadIndex;
  }

  /**
   * Add a new block to the heap at runtime and spawn it immediately (synchronous).
   * Used when the player places a block at the summit.
   */
  addEntry(entry: HeapEntry): void {
    this.data.push(entry);
    this.dirtyBands.clear();
    this.spawnEntry(entry);

    // Immediately rebuild affected bands
    if (this.edgeCollider) {
      for (const bandTop of this.dirtyBands) {
        const bucket = this.entryBuckets.get(bandTop);
        if (bucket) {
          this.edgeCollider.rebuildBand(bandTop, bucket, this.walkableGroup, this.wallGroup);
        }
      }
      this.dirtyBands.clear();
    }
  }

  /**
   * Server path: apply a pre-computed polygon for a band directly.
   * Builds edge colliders and visuals without needing raw entries.
   */
  applyBandPolygon(bandTop: number, vertices: Vertex[]): void {
    this.edgeCollider?.buildFromVertices(bandTop, vertices, this.walkableGroup, this.wallGroup);
    this.chunkRenderer?.renderFromPolygon(bandTop, vertices);
    this.onBandLoaded?.(bandTop, vertices);
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private _sendBatch(toY: number): void {
    const batch: HeapEntry[] = [];
    let i = this.sentCount;
    while (i < this.data.length && this.data[i].y >= toY) {
      batch.push(this.data[i]);
      i++;
    }
    if (batch.length === 0) return;

    this.sentCount += batch.length;
    this.workerBusy = true;

    // Bucket new entries by band
    const newBandBuckets = new Map<number, HeapEntry[]>();
    for (const entry of batch) {
      const def = OBJECT_DEFS[entry.keyid] ?? OBJECT_DEFS[0];
      const top    = entry.y - def.height / 2;
      const bottom = entry.y + def.height / 2;
      const firstBand = Math.floor(top    / CHUNK_BAND_HEIGHT) * CHUNK_BAND_HEIGHT;
      const lastBand  = Math.floor(bottom / CHUNK_BAND_HEIGHT) * CHUNK_BAND_HEIGHT;
      for (let band = firstBand; band <= lastBand; band += CHUNK_BAND_HEIGHT) {
        let b = newBandBuckets.get(band);
        if (!b) { b = []; newBandBuckets.set(band, b); }
        b.push(entry);
      }
    }

    // Build complete per-band entry sets: existing (already flushed) + new.
    // Only for bands with ≥1 new entry — prevents re-rendering already-correct bands.
    const bandInputs: WorkerBandInput[] = [];
    for (const [bandTop, newEntries] of newBandBuckets) {
      const existing = this.entryBuckets.get(bandTop) ?? [];
      bandInputs.push({ bandTop, entries: [...existing, ...newEntries] });
    }

    const msg: WorkerRequest = { bands: bandInputs, newEntries: batch };
    this.worker.postMessage(msg);
  }

  private spawnEntry(entry: HeapEntry): void {
    const def = OBJECT_DEFS[entry.keyid] ?? OBJECT_DEFS[0];

    // Bucket the entry for edge collider rebuilds
    const entryTop    = entry.y - def.height / 2;
    const entryBottom = entry.y + def.height / 2;
    const firstBand = Math.floor(entryTop    / CHUNK_BAND_HEIGHT) * CHUNK_BAND_HEIGHT;
    const lastBand  = Math.floor(entryBottom / CHUNK_BAND_HEIGHT) * CHUNK_BAND_HEIGHT;

    for (let band = firstBand; band <= lastBand; band += CHUNK_BAND_HEIGHT) {
      let bucket = this.entryBuckets.get(band);
      if (!bucket) {
        bucket = [];
        this.entryBuckets.set(band, bucket);
      }
      bucket.push(entry);
      this.dirtyBands.add(band);
    }

    // Visuals (chunk renderer handles its own bucketing)
    this.chunkRenderer?.addEntry(entry);

    const platformTopY = entry.y - def.height / 2;
    this.onPlatformSpawned?.(entry, platformTopY);
  }
}
