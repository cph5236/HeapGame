import { HeapDB, HeapRow } from '../../src/db';
import { Vertex } from '../../../shared/heapTypes';

/** In-memory HeapDB for use in tests. No D1 or Workers runtime needed. */
export class MockHeapDB implements HeapDB {
  private rows = new Map<string, { base_hash: string; version: number; live_zone: string; freeze_y: number }>();
  private bases = new Map<string, string>();

  async getAllHeapIds(): Promise<string[]> {
    return Array.from(this.rows.keys());
  }

  async getPolygonRow(heapId: string): Promise<HeapRow | null> {
    const r = this.rows.get(heapId);
    if (!r) return null;
    return { heap_id: heapId, ...r };
  }

  async upsertPolygonRow(
    heapId: string,
    baseHash: string,
    version: number,
    liveZone: Vertex[],
    freezeY: number,
  ): Promise<void> {
    this.rows.set(heapId, {
      base_hash: baseHash,
      version,
      live_zone: JSON.stringify(liveZone),
      freeze_y: freezeY,
    });
  }

  async getBaseVertices(hash: string): Promise<Vertex[] | null> {
    const raw = this.bases.get(hash);
    return raw ? (JSON.parse(raw) as Vertex[]) : null;
  }

  async upsertBase(hash: string, vertices: Vertex[]): Promise<void> {
    this.bases.set(hash, JSON.stringify(vertices));
  }

  /** Test helper — seed a polygon row directly. `baseHash` defaults to `heapId`. */
  seedPolygon(heapId: string, version: number, liveZone: Vertex[], baseHash?: string, freezeY = 0): void {
    this.rows.set(heapId, {
      base_hash: baseHash ?? heapId,
      version,
      live_zone: JSON.stringify(liveZone),
      freeze_y: freezeY,
    });
  }
}
