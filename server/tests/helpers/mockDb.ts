// server/tests/helpers/mockDb.ts

import type { HeapDB, HeapRow, HeapSummaryRow } from '../../src/db';
import type { HeapParams, Vertex, HeapEnemyParams } from '../../../shared/heapTypes';
import { DEFAULT_HEAP_PARAMS } from '../../../shared/heapTypes';
import type { BandRow } from '../../../shared/heapPolygon/bandEnvelope';

interface BaseRecord {
  heap_id: string;
  vertices: string;
  vertex_hash: string;
  created_at: string;
}

/** In-memory HeapDB for use in tests. No D1 or Workers runtime needed. */
export class MockHeapDB implements HeapDB {
  private heaps = new Map<string, Omit<HeapRow, 'id'>>();
  private bases = new Map<string, BaseRecord>();
  private enemyParams = new Map<string, string>();
  private bands = new Map<string, Map<number, { minX: number; maxX: number; version: number }>>();

  constructor() {
    const SENTINEL = '00000000-0000-0000-0000-000000000000';
    const sentinelParams: HeapEnemyParams = {
      percher: { spawnStartPxAboveFloor: 0, spawnEndPxAboveFloor: -1, spawnRampPxAboveFloor: 15000, spawnChanceMin: 0.15, spawnChanceMax: 0.45 },
      ghost:   { spawnStartPxAboveFloor: 5000, spawnEndPxAboveFloor: -1, spawnRampPxAboveFloor: 20000, spawnChanceMin: 0.10, spawnChanceMax: 0.35 },
    };
    this.enemyParams.set(SENTINEL, JSON.stringify(sentinelParams));
  }

  async listHeaps(): Promise<HeapSummaryRow[]> {
    return Array.from(this.heaps.entries()).map(([id, row]) => ({
      id,
      version: row.version,
      created_at: row.created_at,
      name:            row.name,
      difficulty:      row.difficulty,
      spawn_rate_mult: row.spawn_rate_mult,
      coin_mult:       row.coin_mult,
      score_mult:      row.score_mult,
      world_height:    row.world_height,
      top_y:           row.top_y,
      ghost_point_count: row.ghost_point_count,
      base_item_spawn_rate:     row.base_item_spawn_rate,
      positive_item_spawn_rate: row.positive_item_spawn_rate,
      negative_item_spawn_rate: row.negative_item_spawn_rate,
      locked_by_heap_id: row.locked_by_heap_id,
    }));
  }

  async getHeap(id: string): Promise<HeapRow | null> {
    const row = this.heaps.get(id);
    if (!row) return null;
    return { id, ...row };
  }

  getHeapFresh(id: string): Promise<HeapRow | null> {
    return this.getHeap(id);
  }

  async createHeap(
    heapId: string,
    baseId: string,
    vertices: Vertex[],
    vertexHash: string,
    now: string,
    params: HeapParams = DEFAULT_HEAP_PARAMS,
  ): Promise<void> {
    const initialTopY = vertices.length > 0 ? Math.min(...vertices.map(v => v.y)) : 0;
    const ghostPointCount = (params as any).ghostPointCount ?? 1;
    this.bases.set(baseId, {
      heap_id: heapId,
      vertices: JSON.stringify(vertices),
      vertex_hash: vertexHash,
      created_at: now,
    });
    this.heaps.set(heapId, {
      base_id: baseId,
      live_zone: '[]',
      freeze_y: 0,
      version: 1,
      created_at: now,
      name:            params.name,
      difficulty:      params.difficulty,
      spawn_rate_mult: params.spawnRateMult,
      coin_mult:       params.coinMult,
      score_mult:      params.scoreMult,
      world_height:    params.worldHeight,
      top_y: initialTopY,
      ghost_point_count: ghostPointCount,
      base_item_spawn_rate:     params.baseItemSpawnRate     ?? DEFAULT_HEAP_PARAMS.baseItemSpawnRate,
      positive_item_spawn_rate: params.positiveItemSpawnRate ?? DEFAULT_HEAP_PARAMS.positiveItemSpawnRate,
      negative_item_spawn_rate: params.negativeItemSpawnRate ?? DEFAULT_HEAP_PARAMS.negativeItemSpawnRate,
      locked_by_heap_id: params.lockedByHeapId ?? null,
      live_zone_version: 0,
    });
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
    const existing = this.heaps.get(id);
    if (!existing) return false;
    if (expectedVersion !== undefined && existing.version !== expectedVersion) return false;
    this.heaps.set(id, {
      ...existing,
      base_id: baseId,
      version,
      live_zone: JSON.stringify(liveZone),
      freeze_y: freezeY,
      top_y: Math.min(existing.top_y, topYCandidate),
    });
    return true;
  }

  async updateHeapParams(id: string, params: HeapParams): Promise<void> {
    const existing = this.heaps.get(id);
    if (!existing) return;
    const ghostPointCount = (params as any).ghostPointCount ?? existing.ghost_point_count;
    this.heaps.set(id, {
      ...existing,
      name:            params.name,
      difficulty:      params.difficulty,
      spawn_rate_mult: params.spawnRateMult,
      coin_mult:       params.coinMult,
      score_mult:      params.scoreMult,
      world_height:    params.worldHeight,
      ghost_point_count: ghostPointCount,
      base_item_spawn_rate:     params.baseItemSpawnRate     ?? existing.base_item_spawn_rate,
      positive_item_spawn_rate: params.positiveItemSpawnRate ?? existing.positive_item_spawn_rate,
      negative_item_spawn_rate: params.negativeItemSpawnRate ?? existing.negative_item_spawn_rate,
      locked_by_heap_id: params.lockedByHeapId ?? null,
    });
  }

  async setLiveZoneBlob(heapId: string, liveZone: Vertex[], version: number): Promise<void> {
    const existing = this.heaps.get(heapId);
    if (!existing) return;
    this.heaps.set(heapId, {
      ...existing,
      live_zone: JSON.stringify(liveZone),
      live_zone_version: version,
    });
  }

  async deleteHeap(id: string): Promise<void> {
    this.heaps.delete(id);
    for (const [baseId, base] of this.bases.entries()) {
      if (base.heap_id === id) this.bases.delete(baseId);
    }
  }

  async getBaseVerticesById(baseId: string): Promise<Vertex[] | null> {
    const raw = this.bases.get(baseId);
    return raw ? (JSON.parse(raw.vertices) as Vertex[]) : null;
  }

  async createBase(id: string, heapId: string, vertices: Vertex[], vertexHash: string, now: string): Promise<void> {
    this.bases.set(id, {
      heap_id: heapId,
      vertices: JSON.stringify(vertices),
      vertex_hash: vertexHash,
      created_at: now,
    });
  }

  /**
   * Test helper — seed a heap row directly without going through createHeap.
   * Stamps live_zone_version = version: a directly-seeded blob is assumed to
   * already be current for the state it describes. Tests that need to exercise
   * the lazy-rebuild path do so explicitly via upsertBands + updateHeap, not
   * seedHeap (see liveZoneRebuild.test.ts).
   */
  seedHeap(id: string, version: number, liveZone: Vertex[], baseId = id, freezeY = 0, params: HeapParams = DEFAULT_HEAP_PARAMS): void {
    const ghostPointCount = (params as any).ghostPointCount ?? 1;
    this.heaps.set(id, {
      base_id: baseId,
      version,
      live_zone: JSON.stringify(liveZone),
      live_zone_version: version,
      freeze_y: freezeY,
      created_at: '2026-01-01T00:00:00.000Z',
      name:            params.name,
      difficulty:      params.difficulty,
      spawn_rate_mult: params.spawnRateMult,
      coin_mult:       params.coinMult,
      score_mult:      params.scoreMult,
      world_height:    params.worldHeight,
      top_y: 0,
      ghost_point_count: ghostPointCount,
      base_item_spawn_rate:     params.baseItemSpawnRate     ?? DEFAULT_HEAP_PARAMS.baseItemSpawnRate,
      positive_item_spawn_rate: params.positiveItemSpawnRate ?? DEFAULT_HEAP_PARAMS.positiveItemSpawnRate,
      negative_item_spawn_rate: params.negativeItemSpawnRate ?? DEFAULT_HEAP_PARAMS.negativeItemSpawnRate,
      locked_by_heap_id: params.lockedByHeapId ?? null,
    });
  }

  /** Test helper — seed a base row directly. */
  seedBase(id: string, heapId: string, vertices: Vertex[]): void {
    this.bases.set(id, {
      heap_id: heapId,
      vertices: JSON.stringify(vertices),
      vertex_hash: 'test-hash',
      created_at: '2026-01-01T00:00:00.000Z',
    });
  }

  async getEnemyParams(heapId: string): Promise<HeapEnemyParams> {
    const SENTINEL = '00000000-0000-0000-0000-000000000000';
    const raw = this.enemyParams.get(heapId) ?? this.enemyParams.get(SENTINEL) ?? '{}';
    return JSON.parse(raw) as HeapEnemyParams;
  }

  async upsertEnemyParams(heapId: string, params: HeapEnemyParams): Promise<void> {
    this.enemyParams.set(heapId, JSON.stringify(params));
  }

  /** Test helper — seed enemy params directly. */
  seedEnemyParams(heapId: string, params: HeapEnemyParams): void {
    this.enemyParams.set(heapId, JSON.stringify(params));
  }

  /** Test helper — read top_y directly. */
  getTopYForTest(id: string): number | undefined {
    return this.heaps.get(id)?.top_y;
  }

  /** Test helper — set top_y directly. */
  setTopYForTest(id: string, value: number): void {
    const existing = this.heaps.get(id);
    if (!existing) return;
    this.heaps.set(id, { ...existing, top_y: value });
  }

  async getBand(heapId: string, band: number): Promise<BandRow | null> {
    const cur = this.bands.get(heapId)?.get(band);
    return cur ? { band, minX: cur.minX, maxX: cur.maxX } : null;
  }

  async getAllBands(heapId: string): Promise<BandRow[]> {
    const m = this.bands.get(heapId);
    if (!m) return [];
    return [...m.keys()].sort((a, b) => a - b).map((band) => ({
      band, minX: m.get(band)!.minX, maxX: m.get(band)!.maxX,
    }));
  }

  async getBandsSince(heapId: string, version: number): Promise<BandRow[]> {
    const m = this.bands.get(heapId);
    if (!m) return [];
    return [...m.entries()]
      .filter(([, v]) => v.version > version)
      .sort((a, b) => a[0] - b[0])
      .map(([band, v]) => ({ band, minX: v.minX, maxX: v.maxX }));
  }

  async getMaxBand(heapId: string): Promise<number | null> {
    const m = this.bands.get(heapId);
    if (!m || m.size === 0) return null;
    return Math.max(...m.keys());
  }

  async upsertBands(heapId: string, rows: BandRow[], version: number): Promise<void> {
    let m = this.bands.get(heapId);
    if (!m) { m = new Map(); this.bands.set(heapId, m); }
    for (const r of rows) {
      const cur = m.get(r.band);
      m.set(r.band, cur
        ? { minX: Math.min(cur.minX, r.minX), maxX: Math.max(cur.maxX, r.maxX), version }
        : { minX: r.minX, maxX: r.maxX, version });
    }
  }

  async bumpVersion(heapId: string, topYCandidate: number): Promise<number> {
    const row = this.heaps.get(heapId);
    if (!row) throw new Error(`bumpVersion: heap ${heapId} not found`);
    row.version += 1;
    row.top_y = Math.min(row.top_y, topYCandidate);
    return row.version;
  }
}
