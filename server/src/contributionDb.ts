/** Abstraction over D1 for the player_contribution table (placement counters). */
export interface ContributionDB {
  /** Atomic +1 (insert-at-1 on first placement). */
  increment(heapId: string, playerId: string, now: string): Promise<void>;
  /** Current count, 0 when no row. */
  getCount(heapId: string, playerId: string): Promise<number>;
}

export class D1ContributionDB implements ContributionDB {
  constructor(private d1: D1Database) {}

  async increment(heapId: string, playerId: string, now: string): Promise<void> {
    await this.d1
      .prepare(`
        INSERT INTO player_contribution (heap_id, player_id, count, updated_at)
        VALUES (?1, ?2, 1, ?3)
        ON CONFLICT (heap_id, player_id) DO UPDATE SET count = count + 1, updated_at = ?3
      `)
      .bind(heapId, playerId, now)
      .run();
  }

  async getCount(heapId: string, playerId: string): Promise<number> {
    const row = await this.d1
      .prepare('SELECT count FROM player_contribution WHERE heap_id=?1 AND player_id=?2')
      .bind(heapId, playerId)
      .first<{ count: number }>();
    return row?.count ?? 0;
  }
}
