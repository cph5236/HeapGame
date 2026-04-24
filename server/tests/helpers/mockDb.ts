// server/tests/helpers/mockDb.ts

import type { HeapDB, HeapRow, HeapSummaryRow } from '../../src/db';
import type { HeapParams, Vertex } from '../../../shared/heapTypes';
import { DEFAULT_HEAP_PARAMS } from '../../../shared/heapTypes';

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
    }));
  }

  async getHeap(id: string): Promise<HeapRow | null> {
    const row = this.heaps.get(id);
    if (!row) return null;
    return { id, ...row };
  }

  async createHeap(
    heapId: string,
    baseId: string,
    vertices: Vertex[],
    vertexHash: string,
    now: string,
    params: HeapParams = DEFAULT_HEAP_PARAMS,
  ): Promise<void> {
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
    });
  }

  async updateHeap(id: string, baseId: string, version: number, liveZone: Vertex[], freezeY: number): Promise<void> {
    const existing = this.heaps.get(id);
    if (!existing) return;
    this.heaps.set(id, { ...existing, base_id: baseId, version, live_zone: JSON.stringify(liveZone), freeze_y: freezeY });
  }

  async updateHeapParams(id: string, params: HeapParams): Promise<void> {
    const existing = this.heaps.get(id);
    if (!existing) return;
    this.heaps.set(id, {
      ...existing,
      name:            params.name,
      difficulty:      params.difficulty,
      spawn_rate_mult: params.spawnRateMult,
      coin_mult:       params.coinMult,
      score_mult:      params.scoreMult,
      world_height:    params.worldHeight,
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

  /** Test helper — seed a heap row directly without going through createHeap. */
  seedHeap(id: string, version: number, liveZone: Vertex[], baseId = id, freezeY = 0, params: HeapParams = DEFAULT_HEAP_PARAMS): void {
    this.heaps.set(id, {
      base_id: baseId,
      version,
      live_zone: JSON.stringify(liveZone),
      freeze_y: freezeY,
      created_at: '2026-01-01T00:00:00.000Z',
      name:            params.name,
      difficulty:      params.difficulty,
      spawn_rate_mult: params.spawnRateMult,
      coin_mult:       params.coinMult,
      score_mult:      params.scoreMult,
      world_height:    params.worldHeight,
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
}
