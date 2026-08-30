/** Abstraction over D1 for the player_customization table. */
export interface CustomizationDB {
  /** Returns the stored loadout JSON string, or null if none. */
  getLoadout(playerId: string): Promise<string | null>;
  /** Insert or replace the loadout for a player. */
  upsertLoadout(playerId: string, loadoutJson: string, now: string): Promise<void>;
}

export class D1CustomizationDB implements CustomizationDB {
  constructor(private d1: D1Database) {}

  async getLoadout(playerId: string): Promise<string | null> {
    const row = await this.d1
      .prepare('SELECT loadout FROM player_customization WHERE player_id=?1')
      .bind(playerId)
      .first<{ loadout: string }>();
    return row?.loadout ?? null;
  }

  async upsertLoadout(playerId: string, loadoutJson: string, now: string): Promise<void> {
    await this.d1
      .prepare(`
        INSERT INTO player_customization (player_id, loadout, updated_at)
        VALUES (?1, ?2, ?3)
        ON CONFLICT(player_id) DO UPDATE SET loadout=excluded.loadout, updated_at=excluded.updated_at
      `)
      .bind(playerId, loadoutJson, now)
      .run();
  }
}
