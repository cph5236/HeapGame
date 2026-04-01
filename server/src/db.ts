import { Vertex } from '../../shared/heapTypes';

export interface HeapRow {
  heap_id: string;
  base_hash: string;
  version: number;
  live_zone: string;   // JSON Vertex[]
  freeze_y: number;
}

/** Abstraction over D1 — allows MockHeapDB in tests. */
export interface HeapDB {
  getAllHeapIds(): Promise<string[]>;
  getPolygonRow(heapId: string): Promise<HeapRow | null>;
  upsertPolygonRow(heapId: string, baseHash: string, version: number, liveZone: Vertex[], freezeY: number): Promise<void>;
  getBaseVertices(hash: string): Promise<Vertex[] | null>;
  upsertBase(hash: string, vertices: Vertex[]): Promise<void>;
}

/** Production implementation backed by Cloudflare D1. */
export class D1HeapDB implements HeapDB {
  constructor(private d1: D1Database) {}

  async getAllHeapIds(): Promise<string[]> {
    const result = await this.d1
      .prepare('SELECT heap_id FROM heap_polygon')
      .all<{ heap_id: string }>();
    return result.results.map((r) => r.heap_id);
  }

  async getPolygonRow(heapId: string): Promise<HeapRow | null> {
    const row = await this.d1
      .prepare('SELECT heap_id, base_hash, version, live_zone, freeze_y FROM heap_polygon WHERE heap_id = ?1')
      .bind(heapId)
      .first<HeapRow>();
    return row ?? null;
  }

  async upsertPolygonRow(
    heapId: string,
    baseHash: string,
    version: number,
    liveZone: Vertex[],
    freezeY: number,
  ): Promise<void> {
    await this.d1
      .prepare(
        'INSERT OR REPLACE INTO heap_polygon (heap_id, base_hash, version, live_zone, freeze_y) VALUES (?1, ?2, ?3, ?4, ?5)',
      )
      .bind(heapId, baseHash, version, JSON.stringify(liveZone), freezeY)
      .run();
  }

  async getBaseVertices(hash: string): Promise<Vertex[] | null> {
    const row = await this.d1
      .prepare('SELECT vertices FROM heap_base WHERE hash = ?1')
      .bind(hash)
      .first<{ vertices: string }>();
    return row ? (JSON.parse(row.vertices) as Vertex[]) : null;
  }

  async upsertBase(hash: string, vertices: Vertex[]): Promise<void> {
    await this.d1
      .prepare('INSERT OR REPLACE INTO heap_base (hash, vertices) VALUES (?1, ?2)')
      .bind(hash, JSON.stringify(vertices))
      .run();
  }
}
