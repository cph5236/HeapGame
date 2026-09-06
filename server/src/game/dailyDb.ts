// server/src/dailyDb.ts

/** One daily_claims row (heap_rewards D1). */
export interface DailyClaimRow {
  player_id: string;
  last_claim_at: number;         // unix ms, server clock
  last_claim_offset_min: number; // clamped client UTC offset at claim time
  streak_day: number;            // 1..7
  total_claims: number;
}

/** Abstraction over D1 for Daily Drop claims. Allows MockDailyDb in tests. */
export interface DailyClaimDB {
  get(playerId: string): Promise<DailyClaimRow | null>;

  /**
   * Conditional upsert — the double-claim race guard. Succeeds only when the
   * stored last_claim_at still equals `expectedLastClaimAt` (null = row must
   * not exist yet). Returns false when another device's claim landed first.
   */
  record(
    playerId: string,
    nowMs: number,
    offsetMin: number,
    streakDay: number,
    expectedLastClaimAt: number | null,
  ): Promise<boolean>;
}

/** Production implementation backed by Cloudflare D1. */
export class D1DailyClaimDB implements DailyClaimDB {
  constructor(private d1: D1Database) {}

  async get(playerId: string): Promise<DailyClaimRow | null> {
    const row = await this.d1
      .prepare('SELECT * FROM daily_claims WHERE player_id = ?1')
      .bind(playerId)
      .first<DailyClaimRow>();
    return row ?? null;
  }

  async record(
    playerId: string,
    nowMs: number,
    offsetMin: number,
    streakDay: number,
    expectedLastClaimAt: number | null,
  ): Promise<boolean> {
    if (expectedLastClaimAt === null) {
      const res = await this.d1
        .prepare(
          `INSERT INTO daily_claims
             (player_id, last_claim_at, last_claim_offset_min, streak_day, total_claims)
           VALUES (?1, ?2, ?3, ?4, 1)
           ON CONFLICT (player_id) DO NOTHING`,
        )
        .bind(playerId, nowMs, offsetMin, streakDay)
        .run();
      return (res.meta.changes ?? 0) > 0;
    }
    const res = await this.d1
      .prepare(
        `UPDATE daily_claims
            SET last_claim_at = ?2, last_claim_offset_min = ?3,
                streak_day = ?4, total_claims = total_claims + 1
          WHERE player_id = ?1 AND last_claim_at = ?5`,
      )
      .bind(playerId, nowMs, offsetMin, streakDay, expectedLastClaimAt)
      .run();
    return (res.meta.changes ?? 0) > 0;
  }
}
