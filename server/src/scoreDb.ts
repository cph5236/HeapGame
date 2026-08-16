// server/src/scoreDb.ts

export interface ScoreRow {
  heap_id:    string;
  player_id:  string;
  name:       string;
  score:      number;
  created_at: string;
  updated_at: string;
  /** Serialized loadout from LEFT JOIN player_customization; only populated by
   *  getTopScores / getScoresPaginated. */
  loadout?: string | null;
}

/** Admin-surface row: unfiltered, with ban state resolved. */
export type AdminScoreRow = ScoreRow & { banned: boolean };

/**
 * Abstraction over D1 for score operations.
 * Allows MockScoreDB in tests.
 */
export interface ScoreDB {
  /** Returns the existing score row for this player+heap, or null. */
  getScore(heapId: string, playerId: string): Promise<ScoreRow | null>;

  /**
   * Insert or update score only if newScore > existing score. Names are no
   * longer written here — they live in player_name, seeded/renamed elsewhere.
   * Returns true if the row was inserted or updated, false if existing score was >= newScore.
   */
  upsertScore(heapId: string, playerId: string, score: number, now: string): Promise<boolean>;

  /** Returns top `limit` entries for a heap, ordered by score DESC.
   *  Shadow-banned players are excluded unless they are `viewerId` themselves. */
  getTopScores(heapId: string, limit: number, viewerId?: string): Promise<ScoreRow[]>;

  /**
   * Returns the 1-indexed rank of `score` in `heapId`.
   * Rank = (number of visible rows with score strictly higher) + 1.
   * Shadow-banned players are excluded unless they are `viewerId` themselves,
   * so a hidden player above you does not inflate your rank.
   */
  getRank(heapId: string, score: number, viewerId?: string): Promise<number>;

  /** Returns total number of VISIBLE score rows for a heap — the denominator
   *  the paginated leaderboard shows. See countAllScores for the raw total. */
  countScores(heapId: string, viewerId?: string): Promise<number>;

  /**
   * Deletes rows for heapId ranked beyond the top 1000 (by score DESC).
   * No-op if fewer than 1000 rows exist.
   */
  pruneScores(heapId: string): Promise<void>;

  /** Returns paginated entries for a heap, ordered by score DESC.
   *  Shadow-banned players are excluded unless they are `viewerId` themselves. */
  getScoresPaginated(heapId: string, offset: number, limit: number, viewerId?: string): Promise<ScoreRow[]>;

  /**
   * Returns one entry per heap the player has scored on, ranked within that heap.
   * Rank uses RANK() semantics (ties share the lower rank). Empty array if none.
   * Banned players are excluded from the ranking window, but the subject is
   * always retained even when banned.
   */
  getPlayerScores(playerId: string): Promise<Array<{
    heapId: string;
    name:   string;
    score:  number;
    rank:   number;
  }>>;

  /** Admin surface: one page of a heap's scores, unfiltered, ban state resolved. */
  listScoresForAdmin(heapId: string, offset: number, limit: number): Promise<AdminScoreRow[]>;

  /** Admin surface: raw row count for a heap, banned rows included. countScores
   *  is the filtered count and would stop the admin table short of exactly the
   *  rows it exists to show. */
  countAllScores(heapId: string): Promise<number>;
}

/** Production implementation backed by Cloudflare D1. */
export class D1ScoreDB implements ScoreDB {
  constructor(private d1: D1Database) {}

  async getScore(heapId: string, playerId: string): Promise<ScoreRow | null> {
    const row = await this.d1
      .prepare(`
        SELECT s.heap_id, s.player_id, s.score, s.created_at, s.updated_at,
               COALESCE(pn.name, 'Anonymous') AS name
          FROM score s
          LEFT JOIN player_name pn ON pn.player_id = s.player_id
         WHERE s.heap_id=?1 AND s.player_id=?2
      `)
      .bind(heapId, playerId)
      .first<ScoreRow>();
    return row ?? null;
  }

  async upsertScore(heapId: string, playerId: string, score: number, now: string): Promise<boolean> {
    const existing = await this.getScore(heapId, playerId);
    if (existing && score <= existing.score) return false;

    if (existing) {
      await this.d1
        .prepare('UPDATE score SET score=?1, updated_at=?2 WHERE heap_id=?3 AND player_id=?4')
        .bind(score, now, heapId, playerId)
        .run();
    } else {
      await this.d1
        .prepare('INSERT INTO score (heap_id, player_id, score, created_at, updated_at) VALUES (?1,?2,?3,?4,?5)')
        .bind(heapId, playerId, score, now, now)
        .run();
    }
    return true;
  }

  async getTopScores(heapId: string, limit: number, viewerId = ''): Promise<ScoreRow[]> {
    const result = await this.d1
      .prepare(`
        SELECT s.heap_id, s.player_id, s.score, s.created_at, s.updated_at,
               COALESCE(pn.name, 'Anonymous') AS name,
               pc.loadout AS loadout
          FROM score s
          LEFT JOIN player_name pn          ON pn.player_id = s.player_id
          LEFT JOIN player_customization pc ON pc.player_id = s.player_id
          LEFT JOIN player_ban b            ON b.player_id  = s.player_id
         WHERE s.heap_id=?1 AND (b.player_id IS NULL OR s.player_id=?2)
         ORDER BY s.score DESC
         LIMIT ?3
      `)
      .bind(heapId, viewerId, limit)
      .all<ScoreRow>();
    return result.results;
  }

  async getRank(heapId: string, score: number, viewerId = ''): Promise<number> {
    const result = await this.d1
      .prepare(`
        SELECT COUNT(*) as cnt
          FROM score s
          LEFT JOIN player_ban b ON b.player_id = s.player_id
         WHERE s.heap_id=?1 AND s.score>?2 AND (b.player_id IS NULL OR s.player_id=?3)
      `)
      .bind(heapId, score, viewerId)
      .first<{ cnt: number }>();
    return (result?.cnt ?? 0) + 1;
  }

  async countScores(heapId: string, viewerId = ''): Promise<number> {
    const result = await this.d1
      .prepare(`
        SELECT COUNT(*) as cnt
          FROM score s
          LEFT JOIN player_ban b ON b.player_id = s.player_id
         WHERE s.heap_id=?1 AND (b.player_id IS NULL OR s.player_id=?2)
      `)
      .bind(heapId, viewerId)
      .first<{ cnt: number }>();
    return result?.cnt ?? 0;
  }

  async pruneScores(heapId: string): Promise<void> {
    // Delete all rows for this heap except the top 1000 by score.
    // The subquery selects player_ids of the top 1000; rows not in that set are deleted.
    await this.d1
      .prepare(`
        DELETE FROM score
        WHERE heap_id=?1
          AND player_id NOT IN (
            SELECT player_id FROM score
            WHERE heap_id=?2
            ORDER BY score DESC
            LIMIT 1000
          )
      `)
      .bind(heapId, heapId)
      .run();
  }

  async getScoresPaginated(heapId: string, offset: number, limit: number, viewerId = ''): Promise<ScoreRow[]> {
    const result = await this.d1
      .prepare(`
        SELECT s.heap_id, s.player_id, s.score, s.created_at, s.updated_at,
               COALESCE(pn.name, 'Anonymous') AS name,
               pc.loadout AS loadout
          FROM score s
          LEFT JOIN player_name pn          ON pn.player_id = s.player_id
          LEFT JOIN player_customization pc ON pc.player_id = s.player_id
          LEFT JOIN player_ban b            ON b.player_id  = s.player_id
         WHERE s.heap_id=?1 AND (b.player_id IS NULL OR s.player_id=?2)
         ORDER BY s.score DESC
         LIMIT ?3 OFFSET ?4
      `)
      .bind(heapId, viewerId, limit, offset)
      .all<ScoreRow>();
    return result.results;
  }

  async getPlayerScores(playerId: string): Promise<Array<{
    heapId: string; name: string; score: number; rank: number;
  }>> {
    const result = await this.d1
      .prepare(`
        WITH visible AS (
          SELECT s.heap_id, s.player_id, s.score
            FROM score s
            LEFT JOIN player_ban b ON b.player_id = s.player_id
           WHERE b.player_id IS NULL OR s.player_id = ?1
        ),
        ranked AS (
          SELECT heap_id, player_id, score,
                 RANK() OVER (PARTITION BY heap_id ORDER BY score DESC) AS rank
            FROM visible
        )
        SELECT r.heap_id AS heapId, COALESCE(pn.name, 'Anonymous') AS name, r.score, r.rank
          FROM ranked r
          LEFT JOIN player_name pn ON pn.player_id = r.player_id
         WHERE r.player_id = ?1
      `)
      .bind(playerId)
      .all<{ heapId: string; name: string; score: number; rank: number }>();
    return result.results;
  }

  async listScoresForAdmin(heapId: string, offset: number, limit: number): Promise<AdminScoreRow[]> {
    const result = await this.d1
      .prepare(`
        SELECT s.heap_id, s.player_id, s.score, s.created_at, s.updated_at,
               COALESCE(pn.name, 'Anonymous') AS name,
               CASE WHEN b.player_id IS NULL THEN 0 ELSE 1 END AS banned
          FROM score s
          LEFT JOIN player_name pn ON pn.player_id = s.player_id
          LEFT JOIN player_ban b   ON b.player_id  = s.player_id
         WHERE s.heap_id=?1
         ORDER BY s.score DESC
         LIMIT ?2 OFFSET ?3
      `)
      .bind(heapId, limit, offset)
      .all<ScoreRow & { banned: number }>();
    return result.results.map(r => ({ ...r, banned: r.banned === 1 }));
  }

  async countAllScores(heapId: string): Promise<number> {
    const result = await this.d1
      .prepare('SELECT COUNT(*) as cnt FROM score WHERE heap_id=?1')
      .bind(heapId)
      .first<{ cnt: number }>();
    return result?.cnt ?? 0;
  }
}
