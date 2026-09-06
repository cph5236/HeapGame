/** Abstraction over D1 for the player_name table. */
export interface PlayerNameDB {
  getName(playerId: string): Promise<string | null>;
  setName(playerId: string, name: string, now: string): Promise<void>;
}

export class D1PlayerNameDB implements PlayerNameDB {
  constructor(private d1: D1Database) {}

  async getName(playerId: string): Promise<string | null> {
    const row = await this.d1
      .prepare('SELECT name FROM player_name WHERE player_id=?1')
      .bind(playerId)
      .first<{ name: string }>();
    return row?.name ?? null;
  }

  async setName(playerId: string, name: string, now: string): Promise<void> {
    await this.d1
      .prepare(`
        INSERT INTO player_name (player_id, name, updated_at) VALUES (?1, ?2, ?3)
        ON CONFLICT (player_id) DO UPDATE SET name = ?2, updated_at = ?3
      `)
      .bind(playerId, name, now)
      .run();
  }
}
