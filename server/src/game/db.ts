// server/src/db.ts

import { HeapParams, Vertex, HeapEnemyParams, DEFAULT_HEAP_PARAMS } from '../../../shared/heapTypes';
import { bandOf, type BandRow } from '../../../shared/heapPolygon/bandEnvelope';

/** A band row carrying the version it was last widened at. */
export type VersionedBandRow = BandRow & { version: number };

/** Inputs to a single guarded freeze. See HeapDB.freezeAtomic. */
export interface FreezeArgs {
  heapId: string;
  /** The heap's freeze_y as READ before the freeze decision — never recomputed,
   *  so the REAL-column equality compares an exact round-tripped value. */
  expectedFreezeY: number;
  /** The base_id read alongside expectedFreezeY. base_id now has a second
   *  writer — adminReplaceBands — which can repoint the heap at a repaired
   *  base without moving freeze_y. Guarding on freeze_y alone would let a
   *  freeze built from a stale (pre-repair) base win its CAS purely because
   *  the line hadn't moved, silently discarding the admin's repair. Guarding
   *  on both means freeze only ever writes atop the exact base it read. */
  expectedBaseId: string;
  newBaseId: string;
  baseVertices: Vertex[];
  baseHash: string;
  newFreezeY: number;
  /** Max version among the band rows the caller captured into baseVertices. */
  versionWatermark: number;
  now: string;
}

/** Inputs to a single guarded admin band save. See HeapDB.adminReplaceBands. */
export interface AdminReplaceBandsArgs {
  heapId: string;
  /** The heap version the operator's editor was loaded from. */
  expectedVersion: number;
  /** The base the operator's editor was loaded from. Guarded alongside the
   *  version so a freeze landing mid-edit is caught rather than overwritten. */
  expectedBaseId: string;
  newBaseId: string;
  baseVertices: Vertex[];
  baseHash: string;
  /** heap_band rows to REPLACE. May be empty — the base is minted regardless. */
  liveRows: BandRow[];
  now: string;
}

export interface HeapRow {
  id: string;
  base_id: string;
  /** Legacy: the pre-band-protocol vertex blob. heap_band is authoritative now;
   *  the GET path derives `liveZone` from bands per request and never writes this
   *  back, so it is frozen at whatever migration 0004 backfilled from. */
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
  /** Vestigial. Was the watermark telling the GET path whether live_zone needed
   *  rebuilding; that rebuild-and-persist cost a D1 write plus two KV deletes per
   *  placement, so `liveZone` is now derived per request instead. The column stays
   *  because migration 0005 is already applied remotely — dropping it from the repo
   *  would diverge from deployed schema for no gain. */
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
   * Every band of a heap, ascending, WITH the version each row was last
   * widened at. Separate from getAllBands because BandRow deliberately carries
   * no version — the client's envelope maths has no use for one — and because
   * this must never be served from a cached snapshot.
   *
   * Two callers: the freeze path, which needs the versions to compute the
   * watermark that bounds its DELETE (a stale watermark would let it bury a row
   * the new base never captured), and GET /heaps/:id/bands, which needs the
   * read-through rather than the versions — the admin editor CAS-es on the
   * version it loaded, so a cached snapshot would make saving fail for as long
   * as the entry lives.
   */
  getAllBandsVersioned(heapId: string): Promise<VersionedBandRow[]>;
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
   * Complete a freeze in ONE transaction: mint the new base, repoint the heap at
   * it, advance the freeze line, and DELETE the band rows that line buries.
   * Returns false when the guard fails, in which case NOTHING was written — no
   * base row, no line advance, no deletion.
   *
   * Every statement is guarded on `expectedFreezeY`, the freeze line the caller
   * read before deciding. This is a compare-and-swap, and it has to be, even
   * though placement itself needs none: MIN/MAX band widening is conflict-free,
   * but a freeze is a destructive repoint-and-delete. Two placements crossing
   * the threshold together both read the same pre-freeze base_id and both build
   * a new base from it; without the guard the loser's bands are removed by its
   * own DELETE while surviving only in its orphaned base, which the heap no
   * longer points at. That geometry is unrecoverable — the bug this method
   * exists to close.
   *
   * The guard cannot live in JS between the statements: a D1 batch fixes every
   * statement's bind params before any of them run and executes all of them
   * regardless of what the others did. So the condition is a correlated
   * subquery inside each statement, resolving against the transaction's own
   * state. The INSERT uses SELECT..WHERE so a loser mints no orphan base; the
   * DELETE keys off whether the heap now points at OUR base, which is a
   * stronger test than re-checking the freeze line — two racers can legitimately
   * compute the same line, and base_id is unique per attempt.
   *
   * `versionWatermark` bounds the deletion to rows the new base actually
   * captured. Heap versions are monotonic and heap_band.version is stamped only
   * when a row widens, so a row written after the caller's read provably carries
   * a version above the watermark and survives as a straggler — invisible below
   * the freeze line, but present, and folded into the base by the next freeze.
   * Without it, a placement landing in the frozen slice mid-freeze is deleted
   * having never reached any base.
   *
   * The deletion is what keeps per-request cost bounded. A frozen band's
   * geometry lives in the new base blob, which every client fetches by baseId
   * and caches indefinitely, so the row is pure dead weight the moment freeze_y
   * passes it: getAllBands still returns it on every read and liveBandsOf still
   * filters it out. Left in place it accumulates forever — a staging fixture
   * measured 283 frozen rows against 65 live ones, and the read path paid for
   * all 348.
   *
   * The delete boundary is derived from newFreezeY here rather than passed in,
   * so the deletion can never disagree with the freeze line it is supposed to
   * match.
   *
   * Known gap, pre-existing and narrowed rather than introduced here: reset
   * puts freeze_y back to 0 without a guard, so a freeze that read freeze_y=0
   * before a reset can still satisfy this CAS afterwards and repoint the heap
   * at a base built from pre-reset geometry. The window is a heap's first
   * freeze only. The old unguarded setFreeze was strictly worse — it landed at
   * any freeze_y.
   */
  freezeAtomic(args: FreezeArgs): Promise<boolean>;
  /** Delete every band row for a heap. Used by reset — the fresh base absorbs
   *  the live zone's shape, so the band table starts empty again. */
  clearBands(heapId: string): Promise<void>;
  /**
   * The admin band editor's write, in ONE transaction: mint a new base,
   * repoint the heap at it, bump the version, and REPLACE `liveRows`.
   * Returns false when the guard fails, in which case NOTHING was written.
   *
   * Two things separate this from every other band write.
   *
   * First, replace semantics. `upsertBands` widens with MIN/MAX and therefore
   * structurally cannot shrink a band — which is exactly what repairing a spike
   * requires. This one overwrites.
   *
   * Second, the unconditional new base id, even when `liveRows` is empty and no
   * base band changed. `mergeBands` on the client is MIN/MAX too, so a narrowed
   * band delivered as a delta is merged straight back to its old width; the
   * repair would be correct in D1 and invisible in game. A changed base_id is
   * the existing signal that forces a client to discard its bands and take a
   * full response — the same mechanism reset relies on, and for the same reason.
   *
   * The CAS covers `version` AND `base_id`. Version alone would miss a freeze
   * landing between the operator's read and their save: freeze repoints base_id
   * and moves geometry between the layers, so the plan built from the old read
   * no longer describes the heap.
   *
   * As in freezeAtomic, the guard cannot live in JS between the statements — a
   * D1 batch fixes every statement's bind params before any of them run and
   * executes all of them regardless of what the others did. So each statement
   * carries its own correlated subquery.
   */
  adminReplaceBands(args: AdminReplaceBandsArgs): Promise<boolean>;
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

  async getAllBandsVersioned(heapId: string): Promise<VersionedBandRow[]> {
    const res = await this.d1
      .prepare('SELECT band, min_x, max_x, version FROM heap_band WHERE heap_id = ?1 ORDER BY band')
      .bind(heapId)
      .all<{ band: number; min_x: number; max_x: number; version: number }>();
    return res.results.map((r) => ({ band: r.band, minX: r.min_x, maxX: r.max_x, version: r.version }));
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
               version = CASE WHEN excluded.min_x < min_x OR excluded.max_x > max_x
                              THEN excluded.version ELSE version END`,
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
          // version is stamped only when the row actually WIDENS. A candidate
          // landing inside the stored extent — which most ghost points do —
          // leaves min_x/max_x untouched, and stamping it anyway would put a
          // band with unchanged geometry above every delta client's watermark,
          // so getBandsSince would re-send it for nothing. Each placement
          // touches up to ghostPointCount+1 candidates spread over
          // GHOST_SPREAD_BANDS, so the waste is per-placement and compounds for
          // any client more than a few versions behind.
          //
          // All right-hand sides in a DO UPDATE see the row as it was BEFORE
          // this statement, so the CASE and the MIN/MAX above read the same
          // pre-update min_x/max_x and cannot disagree about whether it widened.
          `INSERT INTO heap_band (heap_id, band, min_x, max_x, version)
           VALUES (?1, ?2, ?3, ?4, (SELECT version FROM heap WHERE id = ?1))
           ON CONFLICT(heap_id, band) DO UPDATE SET
             min_x   = MIN(min_x, excluded.min_x),
             max_x   = MAX(max_x, excluded.max_x),
             version = CASE WHEN excluded.min_x < min_x OR excluded.max_x > max_x
                            THEN excluded.version ELSE version END`,
        )
        .bind(heapId, r.band, r.minX, r.maxX),
    );

    const results = await this.d1.batch<{ version: number }>([bumpStmt, ...bandStmts]);
    const newVersion = results[0]?.results?.[0]?.version;
    if (newVersion === undefined) throw new Error(`commitPlacement: heap ${heapId} not found`);
    return newVersion;
  }

  async freezeAtomic(args: FreezeArgs): Promise<boolean> {
    const { heapId, expectedFreezeY, expectedBaseId, newBaseId, baseVertices, baseHash, newFreezeY, versionWatermark, now } = args;
    const results = await this.d1.batch([
      // 1. Mint the base — only if the line AND the base we built from are both
      //    still current. A losing racer inserts nothing, so there is no orphan
      //    to clean up. The base_id half of this guard is what stops a freeze
      //    computed from a base an admin has since replaced (adminReplaceBands)
      //    from winning just because freeze_y itself never moved.
      this.d1
        .prepare(
          `INSERT INTO heap_base (id, heap_id, vertices, vertex_hash, created_at)
           SELECT ?1, ?2, ?3, ?4, ?5
            WHERE EXISTS (SELECT 1 FROM heap
                           WHERE id = ?2 AND freeze_y = ?6 AND base_id = ?7)`,
        )
        .bind(newBaseId, heapId, JSON.stringify(baseVertices), baseHash, now, expectedFreezeY, expectedBaseId),
      // 2. CAS the heap onto it. This statement's changes count IS the verdict.
      this.d1
        .prepare('UPDATE heap SET base_id = ?1, freeze_y = ?2 WHERE id = ?3 AND freeze_y = ?4 AND base_id = ?5')
        .bind(newBaseId, newFreezeY, heapId, expectedFreezeY, expectedBaseId),
      // 3. Bury rows — only ones the new base captured (version watermark), and
      //    only if statement 2 landed (the heap now points at OUR base).
      this.d1
        .prepare(
          `DELETE FROM heap_band
            WHERE heap_id = ?1 AND band >= ?2 AND version <= ?3
              AND (SELECT base_id FROM heap WHERE id = ?1) = ?4`,
        )
        .bind(heapId, bandOf(newFreezeY), versionWatermark, newBaseId),
    ]);
    return results[1].meta.changes > 0;
  }

  async clearBands(heapId: string): Promise<void> {
    await this.d1
      .prepare('DELETE FROM heap_band WHERE heap_id = ?1')
      .bind(heapId)
      .run();
  }

  async adminReplaceBands(args: AdminReplaceBandsArgs): Promise<boolean> {
    const {
      heapId, expectedVersion, expectedBaseId,
      newBaseId, baseVertices, baseHash, liveRows, now,
    } = args;
    const newVersion = expectedVersion + 1;
    const results = await this.d1.batch([
      // 1. Mint the base — only if the version AND base the operator edited are
      //    both still current. A losing racer inserts nothing, so there is no
      //    orphan row to clean up.
      this.d1
        .prepare(
          `INSERT INTO heap_base (id, heap_id, vertices, vertex_hash, created_at)
           SELECT ?1, ?2, ?3, ?4, ?5
            WHERE EXISTS (SELECT 1 FROM heap
                           WHERE id = ?2 AND version = ?6 AND base_id = ?7)`,
        )
        .bind(newBaseId, heapId, JSON.stringify(baseVertices), baseHash, now,
              expectedVersion, expectedBaseId),
      // 2. CAS the heap onto it. This statement's changes count IS the verdict.
      this.d1
        .prepare(
          `UPDATE heap SET base_id = ?1, version = ?2
            WHERE id = ?3 AND version = ?4 AND base_id = ?5`,
        )
        .bind(newBaseId, newVersion, heapId, expectedVersion, expectedBaseId),
      // 3. REPLACE the live rows — not MIN/MAX. Narrowing is the whole point.
      //    Guarded on the heap now pointing at OUR base: base ids are unique per
      //    attempt, which is a stronger test than re-checking the version.
      ...liveRows.map((r) =>
        this.d1
          .prepare(
            `INSERT INTO heap_band (heap_id, band, min_x, max_x, version)
             SELECT ?1, ?2, ?3, ?4, ?5
              WHERE (SELECT base_id FROM heap WHERE id = ?1) = ?6
             ON CONFLICT(heap_id, band) DO UPDATE SET
               min_x   = excluded.min_x,
               max_x   = excluded.max_x,
               version = excluded.version`,
          )
          .bind(heapId, r.band, r.minX, r.maxX, newVersion, newBaseId),
      ),
    ]);
    return results[1].meta.changes > 0;
  }
}
