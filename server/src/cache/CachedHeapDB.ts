// server/src/cache/CachedHeapDB.ts
//
// Workers KV decorator over a HeapDB. Cache-aside on reads, write-through
// invalidation on writes: the inner D1 write always lands first, then the
// affected KV keys are deleted synchronously so the next read re-populates from
// D1. Reads populate the cache via ctx.waitUntil so the response isn't blocked
// on the KV put.
//
// Keys:
//   cache:heap:{id}     — one heap row           (short TTL; mutated on placement)
//   cache:heap:list     — listHeaps() summary     (short TTL; any heap mutation busts it)
//   cache:base:{baseId} — base vertices           (immutable; long TTL)

import type { HeapDB, HeapRow, HeapSummaryRow } from '../db';
import type { HeapParams, Vertex, HeapEnemyParams } from '../../../shared/heapTypes';
import type { BandRow } from '../../../shared/heapPolygon/bandEnvelope';
import type { Sink } from '../logging/Sink';
import { captureServer } from '../logging/captureServerEvent';

/** live_zone / top_y change on placement → short TTL backs up write-invalidation. */
const HEAP_TTL = 60;
/** Base vertices are immutable once created → long TTL. */
const BASE_TTL = 86_400;

/** Heap row plus its full band set, cached as ONE entry. A delta's watermark must
 *  never exceed the bands served beside it, so these two cannot be cached apart. */
type HeapSnapshot = { row: HeapRow; bands: BandRow[] };

export class CachedHeapDB implements HeapDB {
  constructor(
    private inner: HeapDB,
    private kv: KVNamespace,
    private waitUntil: (p: Promise<unknown>) => void,
    /** Optional telemetry sink — when present, KV failures are also reported as
     *  a 'cache:kv-failed' event so a real outage surfaces in heap_logs instead
     *  of only console.warn. Optional so tests can construct this class directly. */
    private sink?: Sink,
  ) {}

  // ---- reads (cache-aside) ----

  async listHeaps(): Promise<HeapSummaryRow[]> {
    const key = 'cache:heap:list';
    const hit = await this.safeGet<HeapSummaryRow[]>(key);
    if (hit) return hit;
    const rows = await this.inner.listHeaps();
    this.waitUntil(this.kv.put(key, JSON.stringify(rows), { expirationTtl: HEAP_TTL }));
    return rows;
  }

  async getHeap(id: string): Promise<HeapRow | null> {
    return (await this.snapshot(id))?.row ?? null;
  }

  // Bypass the cache entirely — the placement read-modify-write needs the
  // authoritative row so its CAS sees the latest version. Does not populate the
  // cache (the following write-through invalidates it anyway).
  getHeapFresh(id: string): Promise<HeapRow | null> {
    return this.inner.getHeapFresh(id);
  }

  async getBaseVerticesById(baseId: string): Promise<Vertex[] | null> {
    const key = `cache:base:${baseId}`;
    const hit = await this.safeGet<Vertex[]>(key);
    if (hit) return hit;
    const v = await this.inner.getBaseVerticesById(baseId);
    if (v) this.waitUntil(this.kv.put(key, JSON.stringify(v), { expirationTtl: BASE_TTL }));
    return v;
  }

  // ---- writes (D1 first, then synchronous invalidation) ----

  async createHeap(
    heapId: string,
    baseId: string,
    vertices: Vertex[],
    vertexHash: string,
    now: string,
    params?: HeapParams,
  ): Promise<void> {
    await this.inner.createHeap(heapId, baseId, vertices, vertexHash, now, params);
    // createHeap batches in the base row too — populate the immutable base cache.
    await this.invalidateHeap(heapId);
    this.waitUntil(this.kv.put(`cache:base:${baseId}`, JSON.stringify(vertices), { expirationTtl: BASE_TTL }));
  }

  async updateHeap(
    id: string,
    baseId: string,
    version: number,
    liveZone: Vertex[],
    freezeY: number,
    topYCandidate: number,
    expectedVersion?: number,
  ): Promise<boolean> {
    const applied = await this.inner.updateHeap(id, baseId, version, liveZone, freezeY, topYCandidate, expectedVersion);
    // A failed CAS changed nothing — the winning writer already busted the cache.
    if (applied) await this.invalidateHeap(id);
    return applied;
  }

  async updateHeapParams(id: string, params: HeapParams): Promise<void> {
    await this.inner.updateHeapParams(id, params);
    await this.invalidateHeap(id);
  }

  async setLiveZoneBlob(heapId: string, liveZone: Vertex[], version: number): Promise<void> {
    await this.inner.setLiveZoneBlob(heapId, liveZone, version);
    // Without this the cached row keeps reporting the old live_zone_version,
    // and materialiseLiveZone rebuilds on every single read forever.
    await this.invalidateHeap(heapId);
  }

  async deleteHeap(id: string): Promise<void> {
    await this.inner.deleteHeap(id);
    await this.invalidateHeap(id);
    // Orphaned cache:base:{baseId} entries (if any) expire via BASE_TTL — a
    // deleted heap is never queried for its base again.
  }

  async createBase(id: string, heapId: string, vertices: Vertex[], vertexHash: string, now: string): Promise<void> {
    await this.inner.createBase(id, heapId, vertices, vertexHash, now);
    // Base vertices are immutable — safe to populate the cache on write.
    this.waitUntil(this.kv.put(`cache:base:${id}`, JSON.stringify(vertices), { expirationTtl: BASE_TTL }));
  }

  // ---- enemy params: low-traffic, not cached → straight delegation ----

  getEnemyParams(heapId: string): Promise<HeapEnemyParams> {
    return this.inner.getEnemyParams(heapId);
  }

  async upsertEnemyParams(heapId: string, params: HeapEnemyParams): Promise<void> {
    await this.inner.upsertEnemyParams(heapId, params);
  }

  // ---- bands: cached as one snapshot together with the heap row ----

  async getAllBands(heapId: string): Promise<BandRow[]> {
    return (await this.snapshot(heapId))?.bands ?? [];
  }

  async getBand(heapId: string, band: number): Promise<BandRow | null> {
    // Placement containment must not run on a stale extent, or a buried vertex
    // slips through — read through, mirroring getHeapFresh's reasoning.
    return this.inner.getBand(heapId, band);
  }

  async getMaxBand(heapId: string): Promise<number | null> {
    return this.inner.getMaxBand(heapId);
  }

  async getBandRange(heapId: string, fromBand: number, toBand: number): Promise<BandRow[]> {
    // Read-through for the same reason as getBand: this window feeds the
    // placement containment check, and a stale extent there lets a buried
    // vertex through. Serving it from the cached snapshot would also make the
    // window's freshness differ from getBand's, which is worse than either.
    return this.inner.getBandRange(heapId, fromBand, toBand);
  }

  async getBandsSince(heapId: string, version: number): Promise<BandRow[]> {
    // Read-through: fresher than the cached row's version, so a delta may
    // over-send relative to the watermark. That direction is safe — the client
    // merges with MIN/MAX, which is idempotent. The unsafe direction is a fresh
    // row beside stale bands, which the shared snapshot above prevents.
    return this.inner.getBandsSince(heapId, version);
  }

  async upsertBands(heapId: string, rows: BandRow[], version: number): Promise<void> {
    await this.inner.upsertBands(heapId, rows, version);
    await this.invalidateHeap(heapId);
  }

  async clearBands(heapId: string): Promise<void> {
    await this.inner.clearBands(heapId);
    // A write to heap_band — invalidate like every other write, even though
    // bands themselves aren't cached, so any dependent heap-row cache entry
    // (e.g. the list summary) doesn't linger stale past a reset.
    await this.invalidateHeap(heapId);
  }

  async commitPlacement(heapId: string, rows: BandRow[], topYCandidate: number): Promise<number> {
    const newVersion = await this.inner.commitPlacement(heapId, rows, topYCandidate);
    // Invalidate ONCE, after the whole batch has committed. Invalidating
    // between the version bump and the band writes (as a split
    // bumpVersion()+upsertBands() call pair used to) is exactly the window
    // that let a concurrent GET rebuild its snapshot from a bumped row beside
    // not-yet-written bands — a version served with fewer bands than it
    // actually carries, permanently under-claimed by any client that then
    // records it as a watermark.
    await this.invalidateHeap(heapId);
    return newVersion;
  }

  async setFreeze(heapId: string, baseId: string, freezeY: number): Promise<void> {
    await this.inner.setFreeze(heapId, baseId, freezeY);
    // Changes base_id and freeze_y on the heap row — invalidate like every
    // other write, or the cached row keeps pointing at the stale base.
    await this.invalidateHeap(heapId);
  }

  // ---- helpers ----

  /** Cache-aside load of the heap row + its full band set as one snapshot, so a
   *  client can never be handed a version newer than the bands it came with. */
  private async snapshot(id: string): Promise<HeapSnapshot | null> {
    const key = `cache:heap:${id}`;
    const hit = await this.safeGet<HeapSnapshot>(key);
    // Guard against the pre-migration bare-row shape: an entry written by the
    // previous deploy has no `bands` at all. Without this check it would be
    // trusted as-is and every heap would appear bandless for up to HEAP_TTL
    // seconds after release. Anything that doesn't look like a full snapshot
    // falls through to a fresh D1 read, which rewrites the entry correctly.
    if (hit && hit.row && Array.isArray(hit.bands)) return hit;
    const row = await this.inner.getHeap(id);
    if (!row) return null;
    const bands = await this.inner.getAllBands(id);
    const snap: HeapSnapshot = { row, bands };
    this.waitUntil(this.kv.put(key, JSON.stringify(snap), { expirationTtl: HEAP_TTL }));
    return snap;
  }

  /** Bust the per-heap row cache and the list cache. Synchronous (write path). */
  private async invalidateHeap(id: string): Promise<void> {
    await Promise.all([
      this.safeDelete(`cache:heap:${id}`),
      this.safeDelete('cache:heap:list'),
    ]);
  }

  /** KV read that degrades to a cache miss on error, so callers fall through to D1. */
  private async safeGet<T>(key: string): Promise<T | null> {
    try {
      return await this.kv.get<T>(key, 'json');
    } catch (err) {
      console.warn(`[cache] KV get failed key=${key}: ${err instanceof Error ? err.message : String(err)}`);
      await this.reportKvFailure('get', key, err);
      return null;
    }
  }

  /** KV delete that never fails the request. The D1 write already committed;
   *  staleness is bounded by HEAP_TTL. */
  private async safeDelete(key: string): Promise<void> {
    try {
      await this.kv.delete(key);
    } catch (err) {
      console.warn(`[cache] KV delete failed key=${key}: ${err instanceof Error ? err.message : String(err)}`);
      await this.reportKvFailure('delete', key, err);
    }
  }

  /** Best-effort telemetry for a KV failure. Never throws — captureServer
   *  already swallows sink errors internally, and the sink itself is optional. */
  private async reportKvFailure(op: 'get' | 'delete', key: string, err: unknown): Promise<void> {
    if (!this.sink) return;
    await captureServer(this.sink, 'warn', 'cache:kv-failed', {
      op,
      key,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
