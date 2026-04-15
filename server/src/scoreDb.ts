// server/src/scoreDb.ts

export interface ScoreRow {
  heap_id:    string;
  player_id:  string;
  name:       string;
  score:      number;
  created_at: string;
  updated_at: string;
}

/**
 * Abstraction over D1 for score operations.
 * Allows MockScoreDB in tests.
 */
export interface ScoreDB {
  /** Returns the existing score row for this player+heap, or null. */
  getScore(heapId: string, playerId: string): Promise<ScoreRow | null>;

  /**
   * Insert or update score only if newScore > existing score.
   * Also updates name (player may have renamed).
   * Returns true if the row was inserted or updated, false if existing score was >= newScore.
   */
  upsertScore(heapId: string, playerId: string, name: string, score: number, now: string): Promise<boolean>;

  /** Returns top `limit` entries for a heap, ordered by score DESC. */
  getTopScores(heapId: string, limit: number): Promise<ScoreRow[]>;

  /**
   * Returns the 1-indexed rank of `score` in `heapId`.
   * Rank = (number of rows with score strictly higher) + 1.
   */
  getRank(heapId: string, score: number): Promise<number>;

  /** Returns total number of score rows for a heap. */
  countScores(heapId: string): Promise<number>;

  /**
   * Deletes rows for heapId ranked beyond the top 1000 (by score DESC).
   * No-op if fewer than 1000 rows exist.
   */
  pruneScores(heapId: string): Promise<void>;

  /** Returns paginated entries for a heap, ordered by score DESC. */
  getScoresPaginated(heapId: string, offset: number, limit: number): Promise<ScoreRow[]>;
}

/** Production implementation backed by Cloudflare D1. */
export class D1ScoreDB implements ScoreDB {
  constructor(private d1: D1Database) {}

  async getScore(heapId: string, playerId: string): Promise<ScoreRow | null> {
    const row = await this.d1
      .prepare('SELECT * FROM score WHERE heap_id=?1 AND player_id=?2')
      .bind(heapId, playerId)
      .first<ScoreRow>();
    return row ?? null;
  }

  async upsertScore(heapId: string, playerId: string, name: string, score: number, now: string): Promise<boolean> {
    const existing = await this.getScore(heapId, playerId);
    if (existing && score <= existing.score) return false;

    if (existing) {
      await this.d1
        .prepare('UPDATE score SET name=?1, score=?2, updated_at=?3 WHERE heap_id=?4 AND player_id=?5')
        .bind(name, score, now, heapId, playerId)
        .run();
    } else {
      await this.d1
        .prepare('INSERT INTO score (heap_id, player_id, name, score, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6)')
        .bind(heapId, playerId, name, score, now, now)
        .run();
    }
    return true;
  }

  async getTopScores(heapId: string, limit: number): Promise<ScoreRow[]> {
    const result = await this.d1
      .prepare('SELECT * FROM score WHERE heap_id=?1 ORDER BY score DESC LIMIT ?2')
      .bind(heapId, limit)
      .all<ScoreRow>();
    return result.results;
  }

  async getRank(heapId: string, score: number): Promise<number> {
    const result = await this.d1
      .prepare('SELECT COUNT(*) as cnt FROM score WHERE heap_id=?1 AND score>?2')
      .bind(heapId, score)
      .first<{ cnt: number }>();
    return (result?.cnt ?? 0) + 1;
  }

  async countScores(heapId: string): Promise<number> {
    const result = await this.d1
      .prepare('SELECT COUNT(*) as cnt FROM score WHERE heap_id=?1')
      .bind(heapId)
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

  async getScoresPaginated(heapId: string, offset: number, limit: number): Promise<ScoreRow[]> {
    const result = await this.d1
      .prepare('SELECT * FROM score WHERE heap_id=?1 ORDER BY score DESC LIMIT ?2 OFFSET ?3')
      .bind(heapId, limit, offset)
      .all<ScoreRow>();
    return result.results;
  }
}
