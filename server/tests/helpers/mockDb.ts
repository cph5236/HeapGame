import { HeapDB, HeapRow } from '../../src/db';
import { Vertex } from '../../../shared/heapTypes';

/** In-memory HeapDB for use in tests. No D1 or Workers runtime needed. */
export class MockHeapDB implements HeapDB {
  private row: HeapRow = { version: 0, base_hash: '', live_zone: '[]', freeze_y: 0 };
  private bases = new Map<string, string>();

  async getPolygonRow(): Promise<HeapRow> {
    return { ...this.row };
  }

  async updatePolygon(
    version: number,
    baseHash: string,
    liveZone: Vertex[],
    freezeY: number,
  ): Promise<void> {
    this.row = { version, base_hash: baseHash, live_zone: JSON.stringify(liveZone), freeze_y: freezeY };
  }

  async getBaseVertices(hash: string): Promise<Vertex[] | null> {
    const raw = this.bases.get(hash);
    return raw ? (JSON.parse(raw) as Vertex[]) : null;
  }

  async upsertBase(hash: string, vertices: Vertex[]): Promise<void> {
    this.bases.set(hash, JSON.stringify(vertices));
  }

  /** Test helper — seed the polygon row directly. */
  seedPolygon(version: number, liveZone: Vertex[], baseHash = '', freezeY = 0): void {
    this.row = { version, base_hash: baseHash, live_zone: JSON.stringify(liveZone), freeze_y: freezeY };
  }
}
