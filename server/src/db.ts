// server/src/db.ts

import { HeapParams, Vertex, HeapEnemyParams, DEFAULT_HEAP_PARAMS } from '../../shared/heapTypes';

export interface HeapRow {
  id: string;
  base_id: string;
  live_zone: string;
  freeze_y: number;
  version: number;
  created_at: string;
  name: string;
  difficulty: number;
  spawn_rate_mult: number;
  coin_mult: number;
  score_mult: number;
  world_height: number;
  top_y: number;
  ghost_point_count: number;
  base_item_spawn_rate: number;
  positive_item_spawn_rate: number;
  negative_item_spawn_rate: number;
  locked_by_heap_id: string | null;
}

export interface HeapSummaryRow {
  id: string;
  version: number;
  created_at: string;
  name: string;
  difficulty: number;
  spawn_rate_mult: number;
  coin_mult: number;
  score_mult: number;
  world_height: number;
  top_y: number;
  ghost_point_count: number;
  base_item_spawn_rate: number;
  positive_item_spawn_rate: number;
  negative_item_spawn_rate: number;
  locked_by_heap_id: string | null;
}

export interface HeapDB {
  listHeaps(): Promise<HeapSummaryRow[]>;
  getHeap(id: string): Promise<HeapRow | null>;
  /**
   * Like getHeap, but guaranteed to read from the source of truth (D1),
   * bypassing any read cache. Used by the placement read-modify-write so each
   * attempt sees the latest version and the CAS loop converges.
   */
  getHeapFresh(id: string): Promise<HeapRow | null>;
  createHeap(
    heapId: string,
    baseId: string,
    vertices: Vertex[],
    vertexHash: string,
    now: string,
    params?: HeapParams,
  ): Promise<void>;
  /**
   * Update a heap's mutable state. When `expectedVersion` is supplied this is a
   * compare-and-swap: the write only lands if the row's current version still
   * equals `expectedVersion`. Returns true if a row was updated, false on a
   * version mismatch (lost-update conflict). Omitting `expectedVersion` writes
   * unconditionally (used by reset) and always returns true.
   */
  updateHeap(
    id: string,
    baseId: string,
    version: number,
    liveZone: Vertex[],
    freezeY: number,
    expectedVersion?: number,
  ): Promise<boolean>;
  updateHeapParams(id: string, params: HeapParams): Promise<void>;
  updateTopY(id: string, candidateY: number): Promise<void>;
  deleteHeap(id: string): Promise<void>;
  getBaseVerticesById(baseId: string): Promise<Vertex[] | null>;
  createBase(id: string, heapId: string, vertices: Vertex[], vertexHash: string, now: string): Promise<void>;
  getEnemyParams(heapId: string): Promise<HeapEnemyParams>;
  upsertEnemyParams(heapId: string, params: HeapEnemyParams): Promise<void>;
}

export class D1HeapDB implements HeapDB {
  constructor(private d1: D1Database) {}

  async listHeaps(): Promise<HeapSummaryRow[]> {
    const result = await this.d1
      .prepare(
        'SELECT id, version, created_at, name, difficulty, spawn_rate_mult, coin_mult, score_mult, world_height, top_y, ghost_point_count, base_item_spawn_rate, positive_item_spawn_rate, negative_item_spawn_rate, locked_by_heap_id FROM heap',
      )
      .all<HeapSummaryRow>();
    return result.results;
  }

  async getHeap(id: string): Promise<HeapRow | null> {
    const row = await this.d1
      .prepare(
        'SELECT id, base_id, live_zone, freeze_y, version, created_at, name, difficulty, spawn_rate_mult, coin_mult, score_mult, world_height, top_y, ghost_point_count, base_item_spawn_rate, positive_item_spawn_rate, negative_item_spawn_rate, locked_by_heap_id FROM heap WHERE id = ?1',
      )
      .bind(id)
      .first<HeapRow>();
    return row ?? null;
  }

  // D1HeapDB has no read cache, so a fresh read is just a read.
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
    await this.d1.batch([
      this.d1
        .prepare(
          'INSERT INTO heap_base (id, heap_id, vertices, vertex_hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5)',
        )
        .bind(baseId, heapId, JSON.stringify(vertices), vertexHash, now),
      this.d1
        .prepare(
          `INSERT INTO heap (id, base_id, live_zone, freeze_y, version, created_at,
                             name, difficulty, spawn_rate_mult, coin_mult, score_mult, world_height, top_y, ghost_point_count,
                             base_item_spawn_rate, positive_item_spawn_rate, negative_item_spawn_rate, locked_by_heap_id)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)`,
        )
        .bind(
          heapId, baseId, '[]', 0, 1, now,
          params.name, params.difficulty,
          params.spawnRateMult, params.coinMult, params.scoreMult, params.worldHeight,
          initialTopY,
          ghostPointCount,
          params.baseItemSpawnRate, params.positiveItemSpawnRate, params.negativeItemSpawnRate,
          params.lockedByHeapId ?? null,
        ),
    ]);
  }

  async updateHeap(
    id: string,
    baseId: string,
    version: number,
    liveZone: Vertex[],
    freezeY: number,
    expectedVersion?: number,
  ): Promise<boolean> {
    if (expectedVersion === undefined) {
      await this.d1
        .prepare('UPDATE heap SET base_id = ?1, version = ?2, live_zone = ?3, freeze_y = ?4 WHERE id = ?5')
        .bind(baseId, version, JSON.stringify(liveZone), freezeY, id)
        .run();
      return true;
    }
    // Compare-and-swap: only write if the version we read is still current.
    const res = await this.d1
      .prepare('UPDATE heap SET base_id = ?1, version = ?2, live_zone = ?3, freeze_y = ?4 WHERE id = ?5 AND version = ?6')
      .bind(baseId, version, JSON.stringify(liveZone), freezeY, id, expectedVersion)
      .run();
    return (res.meta.changes ?? 0) > 0;
  }

  async updateHeapParams(id: string, params: HeapParams): Promise<void> {
    const ghostPointCount = (params as any).ghostPointCount ?? 1;
    await this.d1
      .prepare(
        `UPDATE heap SET name = ?1, difficulty = ?2, spawn_rate_mult = ?3, coin_mult = ?4, score_mult = ?5, world_height = ?6, ghost_point_count = ?7,
                         base_item_spawn_rate = ?8, positive_item_spawn_rate = ?9, negative_item_spawn_rate = ?10, locked_by_heap_id = ?11
         WHERE id = ?12`,
      )
      .bind(params.name, params.difficulty, params.spawnRateMult, params.coinMult, params.scoreMult, params.worldHeight, ghostPointCount,
            params.baseItemSpawnRate, params.positiveItemSpawnRate, params.negativeItemSpawnRate, params.lockedByHeapId ?? null, id)
      .run();
  }

  async updateTopY(id: string, candidateY: number): Promise<void> {
    await this.d1
      .prepare('UPDATE heap SET top_y = MIN(top_y, ?1) WHERE id = ?2')
      .bind(candidateY, id)
      .run();
  }

  async deleteHeap(id: string): Promise<void> {
    await this.d1.batch([
      this.d1.prepare('DELETE FROM heap_base WHERE heap_id = ?1').bind(id),
      this.d1.prepare('DELETE FROM heap WHERE id = ?1').bind(id),
    ]);
  }

  async getBaseVerticesById(baseId: string): Promise<Vertex[] | null> {
    const row = await this.d1
      .prepare('SELECT vertices FROM heap_base WHERE id = ?1')
      .bind(baseId)
      .first<{ vertices: string }>();
    return row ? (JSON.parse(row.vertices) as Vertex[]) : null;
  }

  async createBase(id: string, heapId: string, vertices: Vertex[], vertexHash: string, now: string): Promise<void> {
    await this.d1
      .prepare('INSERT INTO heap_base (id, heap_id, vertices, vertex_hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5)')
      .bind(id, heapId, JSON.stringify(vertices), vertexHash, now)
      .run();
  }

  async getEnemyParams(heapId: string): Promise<HeapEnemyParams> {
    const row = await this.d1
      .prepare('SELECT enemy_params FROM heap_parameters WHERE heap_id = ?1')
      .bind(heapId)
      .first<{ enemy_params: string }>();
    if (row) return JSON.parse(row.enemy_params) as HeapEnemyParams;

    const sentinel = await this.d1
      .prepare("SELECT enemy_params FROM heap_parameters WHERE heap_id = '00000000-0000-0000-0000-000000000000'")
      .first<{ enemy_params: string }>();
    return sentinel ? (JSON.parse(sentinel.enemy_params) as HeapEnemyParams) : {};
  }

  async upsertEnemyParams(heapId: string, params: HeapEnemyParams): Promise<void> {
    await this.d1
      .prepare(
        `INSERT INTO heap_parameters (heap_id, enemy_params) VALUES (?1, ?2)
         ON CONFLICT (heap_id) DO UPDATE SET enemy_params = excluded.enemy_params`,
      )
      .bind(heapId, JSON.stringify(params))
      .run();
  }
}
