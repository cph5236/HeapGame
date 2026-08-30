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

import type { HeapDB, HeapRow, HeapSummaryRow, VersionedBandRow, FreezeArgs, AdminReplaceBandsArgs } from '../db';
import type { HeapParams, Vertex, HeapEnemyParams } from '../../../../shared/heapTypes';
import type { BandRow } from '../../../../shared/heapPolygon/bandEnvelope';
import type { Sink } from '../../platform/logging/Sink';
import { captureServer } from '../../platform/logging/captureServerEvent';

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

  async getAllBandsVersioned(heapId: string): Promise<VersionedBandRow[]> {
    // Read-through, deliberately. The cached snapshot can lag, and the freeze
    // path uses this read to decide which rows it is safe to DELETE — a stale
    // row set there means burying geometry the new base never captured, which
    // is the exact loss this whole path exists to prevent. Rare enough (once
    // per freeze) that skipping the cache costs nothing measurable.
    return this.inner.getAllBandsVersioned(heapId);
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
    // Row key only. The list summary carries version and topY, both of which
    // this write changes, but nothing reads them for correctness: /place itself
    // reads through getHeapFresh, and the only client consumer is the height
    // label on HeapSelectScene. Letting those go up to HEAP_TTL stale is what a
    // 60s cache means, and it halves the KV deletes on the hottest write path —
    // deletes being the tightest Cloudflare quota at 1,000/day, account-wide.
    // Structural writes (create/delete/reset/params) still bust both, because
    // those change list MEMBERSHIP or params, which is not stale-but-equivalent.
    await this.invalidateHeapRow(heapId);
    return newVersion;
  }

  async freezeAtomic(args: FreezeArgs): Promise<boolean> {
    const applied = await this.inner.freezeAtomic(args);
    // Changes base_id and freeze_y on the heap row AND deletes the band rows the
    // new freeze line buries — invalidate like every other write, or the cached
    // snapshot keeps pointing at the stale base while still serving rows that no
    // longer exist. One invalidation covers both, because the inner call is one
    // transaction.
    //
    // Unconditional, win or lose. A losing freeze wrote nothing, so this
    // invalidation is redundant — but freezes are rare (once per
    // FREEZE_BATCH_BANDS of climb) and a redundant KV delete costs less than a
    // branch whose correctness depends on freezeAtomic's return value being
    // right. Freezes also pay the full two-key cost rather than the row-only
    // shortcut commitPlacement takes.
    await this.invalidateHeap(args.heapId);
    if (applied) {
      // Base vertices are immutable — safe to populate on write, mirroring
      // createBase. Only on a win: a loser's base row does not exist.
      this.waitUntil(this.kv.put(`cache:base:${args.newBaseId}`, JSON.stringify(args.baseVertices), { expirationTtl: BASE_TTL }));
    }
    return applied;
  }

  async adminReplaceBands(args: AdminReplaceBandsArgs): Promise<boolean> {
    const applied = await this.inner.adminReplaceBands(args);
    // Changes base_id and version on the heap row AND rewrites band rows, so
    // both the snapshot and the list summary are stale. invalidateHeap, not
    // invalidateHeapRow: base_id is what a client uses to decide whether its
    // cached geometry is still valid, so serving a stale one is not the
    // cosmetic staleness commitPlacement tolerates.
    //
    // Unconditional, win or lose. A losing CAS wrote nothing, so the delete is
    // redundant — but admin saves are rare, and a redundant KV delete costs
    // less than a branch whose correctness depends on the return value.
    await this.invalidateHeap(args.heapId);
    return applied;
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

  /**
   * Bust only the per-heap snapshot, leaving the list summary to expire on its
   * own TTL. For writes that change a heap's contents but not the list's
   * membership, and whose staleness in the list is cosmetic. One KV delete
   * instead of two.
   */
  private async invalidateHeapRow(id: string): Promise<void> {
    await this.safeDelete(`cache:heap:${id}`);
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
