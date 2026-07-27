// server/src/db.ts

import { HeapParams, Vertex, HeapEnemyParams, DEFAULT_HEAP_PARAMS } from '../../shared/heapTypes';
import type { BandRow } from '../../shared/heapPolygon/bandEnvelope';

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
  live_zone_version: number;
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
    topYCandidate: number,
    expectedVersion?: number,
  ): Promise<boolean>;
  updateHeapParams(id: string, params: HeapParams): Promise<void>;
  /** Store a rebuilt live_zone blob and the heap version it was built from. */
  setLiveZoneBlob(heapId: string, liveZone: Vertex[], version: number): Promise<void>;
  deleteHeap(id: string): Promise<void>;
  getBaseVerticesById(baseId: string): Promise<Vertex[] | null>;
  createBase(id: string, heapId: string, vertices: Vertex[], vertexHash: string, now: string): Promise<void>;
  getEnemyParams(heapId: string): Promise<HeapEnemyParams>;
  upsertEnemyParams(heapId: string, params: HeapEnemyParams): Promise<void>;
  /** One band's extents, or null when the band is empty. Point read on the PK. */
  getBand(heapId: string, band: number): Promise<BandRow | null>;
  /** Every band of a heap, ascending. Used to materialise the full envelope. */
  getAllBands(heapId: string): Promise<BandRow[]>;
  /**
   * Bands in [fromBand, toBand] inclusive, ascending. A bounded range scan off
   * the (heap_id, band) primary key. The placement path needs the band being
   * placed into plus enough context around it to interpolate a new band's
   * unknown side, which is a small window — reading the whole envelope for that
   * would scale per-request work with heap height. Must read through any cache:
   * the containment check decides whether a placement counts, so it cannot run
   * on a stale snapshot.
   */
  getBandRange(heapId: string, fromBand: number, toBand: number): Promise<BandRow[]>;
  /** Bands whose last change is strictly newer than `version`, ascending. */
  getBandsSince(heapId: string, version: number): Promise<BandRow[]>;
  /** Highest occupied band, or null when the heap has none. O(log n) off the PK. */
  getMaxBand(heapId: string): Promise<number | null>;
  /**
   * Widen bands with MIN/MAX and stamp them with `version`. Conflict-free: two
   * concurrent callers targeting the same band both apply, so this needs no CAS.
   * Used directly by tests to seed band state; the placement path itself goes
   * through `commitPlacement` so the stamp and the version bump land together.
   */
  upsertBands(heapId: string, rows: BandRow[], version: number): Promise<void>;
  /**
   * The placement write: atomically increment the heap version, lower top_y
   * toward the summit, and widen `rows` with MIN/MAX — all stamped with the
   * SAME version, in one transaction. Returns the new version.
   *
   * This one-transaction requirement is not cosmetic: a version bump and a
   * band write issued as two separate calls leaves a window where a concurrent
   * reader can observe the bumped version before the band write lands (or vice
   * versa under a cache that invalidates between the two). Since a delta
   * client filters strictly on `version > watermark`, a band under-stamped
   * relative to the version served beside it is lost to that client forever —
   * `getBandsSince` will never surface it again. `commitPlacement` closes that
   * window by construction: whatever the caller observes, either both writes
   * are visible or neither is.
   */
  commitPlacement(heapId: string, rows: BandRow[], topYCandidate: number): Promise<number>;
  /**
   * Repoint the heap at a freshly-minted base and advance the freeze line.
   * Called after folding the bottom bands into a new base snapshot; bands at
   * or above freezeY remain the live set.
   */
  setFreeze(heapId: string, baseId: string, freezeY: number): Promise<void>;
  /** Delete every band row for a heap. Used by reset — the fresh base absorbs
   *  the live zone's shape, so the band table starts empty again. */
  clearBands(heapId: string): Promise<void>;
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
        'SELECT id, base_id, live_zone, freeze_y, version, created_at, name, difficulty, spawn_rate_mult, coin_mult, score_mult, world_height, top_y, ghost_point_count, base_item_spawn_rate, positive_item_spawn_rate, negative_item_spawn_rate, locked_by_heap_id, live_zone_version FROM heap WHERE id = ?1',
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
    topYCandidate: number,
    expectedVersion?: number,
  ): Promise<boolean> {
    // top_y is the summit — the LOWEST y — so MIN() only ever raises the peak.
    // Folding it into the CAS makes the summit update atomic with the placement
    // and halves both the D1 writes and the KV invalidations per placement.
    if (expectedVersion === undefined) {
      await this.d1
        .prepare('UPDATE heap SET base_id = ?1, version = ?2, live_zone = ?3, freeze_y = ?4, top_y = MIN(top_y, ?5) WHERE id = ?6')
        .bind(baseId, version, JSON.stringify(liveZone), freezeY, topYCandidate, id)
        .run();
      return true;
    }
    const res = await this.d1
      .prepare('UPDATE heap SET base_id = ?1, version = ?2, live_zone = ?3, freeze_y = ?4, top_y = MIN(top_y, ?5) WHERE id = ?6 AND version = ?7')
      .bind(baseId, version, JSON.stringify(liveZone), freezeY, topYCandidate, id, expectedVersion)
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

  async setLiveZoneBlob(heapId: string, liveZone: Vertex[], version: number): Promise<void> {
    await this.d1
      .prepare('UPDATE heap SET live_zone = ?1, live_zone_version = ?2 WHERE id = ?3')
      .bind(JSON.stringify(liveZone), version, heapId)
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

  async getBand(heapId: string, band: number): Promise<BandRow | null> {
    const row = await this.d1
      .prepare('SELECT band, min_x, max_x FROM heap_band WHERE heap_id = ?1 AND band = ?2')
      .bind(heapId, band)
      .first<{ band: number; min_x: number; max_x: number }>();
    return row ? { band: row.band, minX: row.min_x, maxX: row.max_x } : null;
  }

  async getAllBands(heapId: string): Promise<BandRow[]> {
    const res = await this.d1
      .prepare('SELECT band, min_x, max_x FROM heap_band WHERE heap_id = ?1 ORDER BY band')
      .bind(heapId)
      .all<{ band: number; min_x: number; max_x: number }>();
    return res.results.map((r) => ({ band: r.band, minX: r.min_x, maxX: r.max_x }));
  }

  async getBandRange(heapId: string, fromBand: number, toBand: number): Promise<BandRow[]> {
    const res = await this.d1
      .prepare('SELECT band, min_x, max_x FROM heap_band WHERE heap_id = ?1 AND band BETWEEN ?2 AND ?3 ORDER BY band')
      .bind(heapId, fromBand, toBand)
      .all<{ band: number; min_x: number; max_x: number }>();
    return res.results.map((r) => ({ band: r.band, minX: r.min_x, maxX: r.max_x }));
  }

  async getBandsSince(heapId: string, version: number): Promise<BandRow[]> {
    const res = await this.d1
      .prepare('SELECT band, min_x, max_x FROM heap_band WHERE heap_id = ?1 AND version > ?2 ORDER BY band')
      .bind(heapId, version)
      .all<{ band: number; min_x: number; max_x: number }>();
    return res.results.map((r) => ({ band: r.band, minX: r.min_x, maxX: r.max_x }));
  }

  async getMaxBand(heapId: string): Promise<number | null> {
    const row = await this.d1
      .prepare('SELECT MAX(band) AS m FROM heap_band WHERE heap_id = ?1')
      .bind(heapId)
      .first<{ m: number | null }>();
    return row?.m ?? null;
  }

  async upsertBands(heapId: string, rows: BandRow[], version: number): Promise<void> {
    if (rows.length === 0) return;
    await this.d1.batch(
      rows.map((r) =>
        this.d1
          .prepare(
            `INSERT INTO heap_band (heap_id, band, min_x, max_x, version)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(heap_id, band) DO UPDATE SET
               min_x   = MIN(min_x, excluded.min_x),
               max_x   = MAX(max_x, excluded.max_x),
               version = excluded.version`,
          )
          .bind(heapId, r.band, r.minX, r.maxX, version),
      ),
    );
  }

  async commitPlacement(heapId: string, rows: BandRow[], topYCandidate: number): Promise<number> {
    // One batch = one D1 transaction, statements run sequentially inside it.
    // The band upserts read `version` back via a scalar subquery rather than
    // a JS value threaded from the first statement's result — a batch's
    // statements are all prepared (and their bind params fixed) before any of
    // them run, so the first statement's RETURNING value is not available to
    // bind into the others. The subquery reads the row as of ITS point in the
    // same transaction, which is after the bump, so it always resolves to the
    // version the first statement just wrote — never the one before it.
    const bumpStmt = this.d1
      .prepare('UPDATE heap SET version = version + 1, top_y = MIN(top_y, ?1) WHERE id = ?2 RETURNING version')
      .bind(topYCandidate, heapId);

    const bandStmts = rows.map((r) =>
      this.d1
        .prepare(
          `INSERT INTO heap_band (heap_id, band, min_x, max_x, version)
           VALUES (?1, ?2, ?3, ?4, (SELECT version FROM heap WHERE id = ?1))
           ON CONFLICT(heap_id, band) DO UPDATE SET
             min_x   = MIN(min_x, excluded.min_x),
             max_x   = MAX(max_x, excluded.max_x),
             version = excluded.version`,
        )
        .bind(heapId, r.band, r.minX, r.maxX),
    );

    const results = await this.d1.batch<{ version: number }>([bumpStmt, ...bandStmts]);
    const newVersion = results[0]?.results?.[0]?.version;
    if (newVersion === undefined) throw new Error(`commitPlacement: heap ${heapId} not found`);
    return newVersion;
  }

  async setFreeze(heapId: string, baseId: string, freezeY: number): Promise<void> {
    await this.d1
      .prepare('UPDATE heap SET base_id = ?1, freeze_y = ?2 WHERE id = ?3')
      .bind(baseId, freezeY, heapId)
      .run();
  }

  async clearBands(heapId: string): Promise<void> {
    await this.d1
      .prepare('DELETE FROM heap_band WHERE heap_id = ?1')
      .bind(heapId)
      .run();
  }
}
