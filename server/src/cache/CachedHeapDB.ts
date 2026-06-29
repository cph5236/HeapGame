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

/** live_zone / top_y change on placement → short TTL backs up write-invalidation. */
const HEAP_TTL = 60;
/** Base vertices are immutable once created → long TTL. */
const BASE_TTL = 86_400;

export class CachedHeapDB implements HeapDB {
  constructor(
    private inner: HeapDB,
    private kv: KVNamespace,
    private waitUntil: (p: Promise<unknown>) => void,
  ) {}

  // ---- reads (cache-aside) ----

  async listHeaps(): Promise<HeapSummaryRow[]> {
    const key = 'cache:heap:list';
    const hit = await this.kv.get<HeapSummaryRow[]>(key, 'json');
    if (hit) return hit;
    const rows = await this.inner.listHeaps();
    this.waitUntil(this.kv.put(key, JSON.stringify(rows), { expirationTtl: HEAP_TTL }));
    return rows;
  }

  async getHeap(id: string): Promise<HeapRow | null> {
    const key = `cache:heap:${id}`;
    const hit = await this.kv.get<HeapRow>(key, 'json');
    if (hit) return hit;
    const row = await this.inner.getHeap(id);
    if (row) this.waitUntil(this.kv.put(key, JSON.stringify(row), { expirationTtl: HEAP_TTL }));
    return row;
  }

  async getBaseVerticesById(baseId: string): Promise<Vertex[] | null> {
    const key = `cache:base:${baseId}`;
    const hit = await this.kv.get<Vertex[]>(key, 'json');
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

  async updateHeap(id: string, baseId: string, version: number, liveZone: Vertex[], freezeY: number): Promise<void> {
    await this.inner.updateHeap(id, baseId, version, liveZone, freezeY);
    await this.invalidateHeap(id);
  }

  async updateHeapParams(id: string, params: HeapParams): Promise<void> {
    await this.inner.updateHeapParams(id, params);
    await this.invalidateHeap(id);
  }

  async updateTopY(id: string, candidateY: number): Promise<void> {
    await this.inner.updateTopY(id, candidateY);
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

  // ---- helpers ----

  /** Bust the per-heap row cache and the list cache. Synchronous (write path). */
  private async invalidateHeap(id: string): Promise<void> {
    await Promise.all([
      this.kv.delete(`cache:heap:${id}`),
      this.kv.delete('cache:heap:list'),
    ]);
  }
}
