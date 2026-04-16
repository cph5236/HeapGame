// server/src/db.ts

import { HeapParams, Vertex } from '../../shared/heapTypes';
import { DEFAULT_HEAP_PARAMS } from '../../shared/heapTypes';

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
}

export interface HeapDB {
  listHeaps(): Promise<HeapSummaryRow[]>;
  getHeap(id: string): Promise<HeapRow | null>;
  createHeap(
    heapId: string,
    baseId: string,
    vertices: Vertex[],
    vertexHash: string,
    now: string,
    params?: HeapParams,
  ): Promise<void>;
  updateHeap(id: string, baseId: string, version: number, liveZone: Vertex[], freezeY: number): Promise<void>;
  updateHeapParams(id: string, params: HeapParams): Promise<void>;
  deleteHeap(id: string): Promise<void>;
  getBaseVerticesById(baseId: string): Promise<Vertex[] | null>;
  createBase(id: string, heapId: string, vertices: Vertex[], vertexHash: string, now: string): Promise<void>;
}

export class D1HeapDB implements HeapDB {
  constructor(private d1: D1Database) {}

  async listHeaps(): Promise<HeapSummaryRow[]> {
    const result = await this.d1
      .prepare(
        'SELECT id, version, created_at, name, difficulty, spawn_rate_mult, coin_mult, score_mult FROM heap',
      )
      .all<HeapSummaryRow>();
    return result.results;
  }

  async getHeap(id: string): Promise<HeapRow | null> {
    const row = await this.d1
      .prepare(
        'SELECT id, base_id, live_zone, freeze_y, version, created_at, name, difficulty, spawn_rate_mult, coin_mult, score_mult FROM heap WHERE id = ?1',
      )
      .bind(id)
      .first<HeapRow>();
    return row ?? null;
  }

  async createHeap(
    heapId: string,
    baseId: string,
    vertices: Vertex[],
    vertexHash: string,
    now: string,
    params: HeapParams = DEFAULT_HEAP_PARAMS,
  ): Promise<void> {
    await this.d1.batch([
      this.d1
        .prepare(
          'INSERT INTO heap_base (id, heap_id, vertices, vertex_hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5)',
        )
        .bind(baseId, heapId, JSON.stringify(vertices), vertexHash, now),
      this.d1
        .prepare(
          `INSERT INTO heap (id, base_id, live_zone, freeze_y, version, created_at,
                             name, difficulty, spawn_rate_mult, coin_mult, score_mult)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
        )
        .bind(
          heapId, baseId, '[]', 0, 1, now,
          params.name, params.difficulty,
          params.spawnRateMult, params.coinMult, params.scoreMult,
        ),
    ]);
  }

  async updateHeap(id: string, baseId: string, version: number, liveZone: Vertex[], freezeY: number): Promise<void> {
    await this.d1
      .prepare('UPDATE heap SET base_id = ?1, version = ?2, live_zone = ?3, freeze_y = ?4 WHERE id = ?5')
      .bind(baseId, version, JSON.stringify(liveZone), freezeY, id)
      .run();
  }

  async updateHeapParams(id: string, params: HeapParams): Promise<void> {
    await this.d1
      .prepare(
        `UPDATE heap SET name = ?1, difficulty = ?2, spawn_rate_mult = ?3, coin_mult = ?4, score_mult = ?5
         WHERE id = ?6`,
      )
      .bind(params.name, params.difficulty, params.spawnRateMult, params.coinMult, params.scoreMult, id)
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
}
