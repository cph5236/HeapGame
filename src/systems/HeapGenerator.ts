import Phaser from 'phaser';
import { HeapEntry } from '../data/heapTypes';
import { OBJECT_DEFS } from '../data/heapObjectDefs';
import { CHUNK_BAND_HEIGHT, MOCK_HEAP_HEIGHT_PX } from '../constants';
import { HeapChunkRenderer } from './HeapChunkRenderer';
import { HeapEdgeCollider } from './HeapEdgeCollider';
import { Vertex } from './HeapPolygon';

export class HeapGenerator {
  private readonly group: Phaser.Physics.Arcade.StaticGroup;
  private readonly chunkRenderer?: HeapChunkRenderer;
  private readonly edgeCollider?: HeapEdgeCollider;

  onPlatformSpawned?: (entry: HeapEntry, platformTopY: number) => void;

  // Data sorted by Y descending (highest Y = bottom of heap = index 0).
  // This matches the order the player encounters them: bottom first, summit last.
  private readonly data: HeapEntry[];

  // Pointer into data[]. Everything before this index has already been spawned.
  private nextLoadIndex: number = 0;

  // Track which bands need edge collider rebuilds during batch streaming
  private readonly dirtyBands: Set<number> = new Set();

  // Entry buckets mirroring HeapChunkRenderer's, used for edge collider rebuilds
  private readonly entryBuckets: Map<number, HeapEntry[]> = new Map();

  constructor(
    _scene: Phaser.Scene,
    group: Phaser.Physics.Arcade.StaticGroup,
    data: HeapEntry[],
    chunkRenderer?: HeapChunkRenderer,
    edgeCollider?: HeapEdgeCollider,
  ) {
    this.group = group;
    this.chunkRenderer = chunkRenderer;
    this.edgeCollider = edgeCollider;
    // Sort defensively in case caller passes unsorted data
    this.data = [...data].sort((a, b) => b.y - a.y);
  }

  /** Live read-only view of all entries — used by findSurfaceY at runtime. */
  get entries(): readonly HeapEntry[] {
    return this.data;
  }

  /**
   * Y of the heap's topmost surface (smallest top-edge Y across all entries).
   * Used to define the player placement zone.
   */
  get topY(): number {
    let min = MOCK_HEAP_HEIGHT_PX;
    for (const e of this.data) {
      const def = OBJECT_DEFS[e.keyid] ?? OBJECT_DEFS[0];
      const top = e.y - def.height / 2;
      if (top < min) min = top;
    }
    return min;
  }

  /**
   * Instantiate all heap objects whose center Y is >= toY that haven't been
   * spawned yet. Call this as the player climbs (toY decreases over time).
   * Edge collider rebuilds are batched — all affected bands are rebuilt once
   * after the streaming loop, not per-entry.
   */
  generateUpTo(toY: number): void {
    this.dirtyBands.clear();

    while (
      this.nextLoadIndex < this.data.length &&
      this.data[this.nextLoadIndex].y >= toY
    ) {
      this.spawnEntry(this.data[this.nextLoadIndex]);
      this.nextLoadIndex++;
    }

    // Batch-rebuild edge colliders for all bands that received new entries
    if (this.edgeCollider && this.dirtyBands.size > 0) {
      for (const bandTop of this.dirtyBands) {
        const bucket = this.entryBuckets.get(bandTop);
        if (bucket) {
          this.edgeCollider.rebuildBand(bandTop, bucket, this.group);
        }
      }
      this.dirtyBands.clear();
    }
  }

  /**
   * Add a new block to the heap at runtime and spawn it immediately.
   * Used when the player places a block at the summit.
   * Bypasses the streaming pointer — entry is spawned directly,
   * and affected bands are rebuilt immediately.
   */
  addEntry(entry: HeapEntry): void {
    this.data.push(entry);
    this.dirtyBands.clear();
    this.spawnEntry(entry);

    // Immediately rebuild affected bands (not deferred like generateUpTo)
    if (this.edgeCollider) {
      for (const bandTop of this.dirtyBands) {
        const bucket = this.entryBuckets.get(bandTop);
        if (bucket) {
          this.edgeCollider.rebuildBand(bandTop, bucket, this.group);
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
    this.edgeCollider?.buildFromVertices(bandTop, vertices, this.group);
    this.chunkRenderer?.renderFromPolygon(bandTop, vertices);
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
