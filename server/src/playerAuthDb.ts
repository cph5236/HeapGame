/** Abstraction over D1 for the player_auth table (write-auth secret hashes). */
export interface PlayerAuthDB {
  /** Returns the stored secret hash, or null if the player is unclaimed. */
  getSecretHash(playerId: string): Promise<string | null>;
  /** Claim a player id by storing its secret hash. */
  insert(playerId: string, secretHash: string, now: string): Promise<void>;
  /** Admin unclaim — removes the row so the next tokened write re-claims. */
  delete(playerId: string): Promise<void>;
}

export class D1PlayerAuthDB implements PlayerAuthDB {
  constructor(private d1: D1Database) {}

  async getSecretHash(playerId: string): Promise<string | null> {
    const row = await this.d1
      .prepare('SELECT secret_hash FROM player_auth WHERE player_id=?1')
      .bind(playerId)
      .first<{ secret_hash: string }>();
    return row?.secret_hash ?? null;
  }

  async insert(playerId: string, secretHash: string, now: string): Promise<void> {
    await this.d1
      .prepare('INSERT OR IGNORE INTO player_auth (player_id, secret_hash, created_at) VALUES (?1, ?2, ?3)')
      .bind(playerId, secretHash, now)
      .run();
  }

  async delete(playerId: string): Promise<void> {
    await this.d1
      .prepare('DELETE FROM player_auth WHERE player_id=?1')
      .bind(playerId)
      .run();
  }
}
