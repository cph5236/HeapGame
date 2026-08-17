// server/src/banDb.ts

export interface BanRow {
  player_id: string;
  reason:    string | null;
  banned_at: string;
}

/**
 * Abstraction over D1 for the player_ban table. Allows MockBanDB in tests.
 *
 * `isBanned` sits on the leaderboard read path — see cache/MemoBanDB.ts, which
 * memoises it per isolate so the hot path does not pay a D1 read per request.
 */
export interface BanDB {
  /** True if this player is shadow-banned. */
  isBanned(playerId: string): Promise<boolean>;
  /** Full ban row, or null if the player is not banned. */
  get(playerId: string): Promise<BanRow | null>;
  /** Every ban, newest first. Admin surface only — never on a player path. */
  list(): Promise<BanRow[]>;
  /** Idempotent upsert; re-banning overwrites reason and banned_at. */
  ban(playerId: string, reason: string | null, now: string): Promise<void>;
  /** Idempotent delete; unbanning an unbanned player is a no-op. */
  unban(playerId: string): Promise<void>;
}

/** Production implementation backed by Cloudflare D1 (heap_scores). */
export class D1BanDB implements BanDB {
  constructor(private d1: D1Database) {}

  async isBanned(playerId: string): Promise<boolean> {
    const row = await this.d1
      .prepare('SELECT 1 AS hit FROM player_ban WHERE player_id=?1')
      .bind(playerId)
      .first<{ hit: number }>();
    return row !== null;
  }

  async get(playerId: string): Promise<BanRow | null> {
    const row = await this.d1
      .prepare('SELECT player_id, reason, banned_at FROM player_ban WHERE player_id=?1')
      .bind(playerId)
      .first<BanRow>();
    return row ?? null;
  }

  async list(): Promise<BanRow[]> {
    const result = await this.d1
      .prepare('SELECT player_id, reason, banned_at FROM player_ban ORDER BY banned_at DESC')
      .all<BanRow>();
    return result.results;
  }

  async ban(playerId: string, reason: string | null, now: string): Promise<void> {
    await this.d1
      .prepare(`
        INSERT INTO player_ban (player_id, reason, banned_at) VALUES (?1, ?2, ?3)
        ON CONFLICT (player_id) DO UPDATE SET reason = ?2, banned_at = ?3
      `)
      .bind(playerId, reason, now)
      .run();
  }

  async unban(playerId: string): Promise<void> {
    await this.d1
      .prepare('DELETE FROM player_ban WHERE player_id=?1')
      .bind(playerId)
      .run();
  }
}
