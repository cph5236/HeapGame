import { Vertex } from '../../shared/heapTypes';

export interface HeapRow {
  version: number;
  base_hash: string;
  live_zone: string;   // JSON Vertex[]
  freeze_y: number;
}

/** Abstraction over D1 — allows MockHeapDB in tests. */
export interface HeapDB {
  getPolygonRow(): Promise<HeapRow>;
  updatePolygon(version: number, baseHash: string, liveZone: Vertex[], freezeY: number): Promise<void>;
  getBaseVertices(hash: string): Promise<Vertex[] | null>;
  upsertBase(hash: string, vertices: Vertex[]): Promise<void>;
}

/** Production implementation backed by Cloudflare D1. */
export class D1HeapDB implements HeapDB {
  constructor(private d1: D1Database) {}

  async getPolygonRow(): Promise<HeapRow> {
    const row = await this.d1
      .prepare('SELECT * FROM heap_polygon WHERE id = 1')
      .first<HeapRow>();
    return row!;
  }

  async updatePolygon(
    version: number,
    baseHash: string,
    liveZone: Vertex[],
    freezeY: number,
  ): Promise<void> {
    await this.d1
      .prepare(
        'UPDATE heap_polygon SET version = ?1, base_hash = ?2, live_zone = ?3, freeze_y = ?4 WHERE id = 1',
      )
      .bind(version, baseHash, JSON.stringify(liveZone), freezeY)
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
