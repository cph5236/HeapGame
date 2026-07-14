import type { ScoreDB, ScoreRow } from '../../src/scoreDb';
import type { PlayerNameDB } from '../../src/playerNameDb';

/**
 * In-memory ScoreDB for use in tests. No D1 or Workers runtime needed.
 *
 * Name resolution mirrors the D1 LEFT JOIN player_name: an attached
 * PlayerNameDB (via attachNameDb) takes precedence, falling back to names
 * seeded directly via `seed()` (a shadow player_name map — a convenience for
 * tests that don't exercise the full submit → seed-name → read pipeline),
 * and finally 'Anonymous'.
 */
export class MockScoreDB implements ScoreDB {
  // key: `${heapId}::${playerId}`
  private rows = new Map<string, ScoreRow>();
  private loadouts = new Map<string, string>();
  private names = new Map<string, string>();
  private nameDb: PlayerNameDB | null = null;

  private key(heapId: string, playerId: string): string {
    return `${heapId}::${playerId}`;
  }

  /** Wire an external PlayerNameDB (e.g. shared with a route under test); takes
   *  precedence over names seeded directly via `seed()`. */
  attachNameDb(nameDb: PlayerNameDB): void {
    this.nameDb = nameDb;
  }

  private async resolveName(playerId: string): Promise<string> {
    if (this.nameDb) {
      const name = await this.nameDb.getName(playerId);
      if (name !== null) return name;
    }
    return this.names.get(playerId) ?? 'Anonymous';
  }

  async getScore(heapId: string, playerId: string): Promise<ScoreRow | null> {
    const row = this.rows.get(this.key(heapId, playerId));
    if (!row) return null;
    return { ...row, name: await this.resolveName(playerId) };
  }

  async upsertScore(heapId: string, playerId: string, score: number, now: string): Promise<boolean> {
    const existing = this.rows.get(this.key(heapId, playerId));
    if (existing && score <= existing.score) return false;

    this.rows.set(this.key(heapId, playerId), {
      heap_id:    heapId,
      player_id:  playerId,
      name:       '', // legacy column, unread — resolved via resolveName on read
      score,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    });
    return true;
  }

  private async withJoins(r: ScoreRow): Promise<ScoreRow> {
    return {
      ...r,
      name:    await this.resolveName(r.player_id),
      loadout: this.loadouts.get(r.player_id) ?? null,
    };
  }

  async getTopScores(heapId: string, limit: number): Promise<ScoreRow[]> {
    const rows = Array.from(this.rows.values())
      .filter(r => r.heap_id === heapId)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return Promise.all(rows.map(r => this.withJoins(r)));
  }

  async getRank(heapId: string, score: number): Promise<number> {
    const above = Array.from(this.rows.values())
      .filter(r => r.heap_id === heapId && r.score > score)
      .length;
    return above + 1;
  }

  async countScores(heapId: string): Promise<number> {
    return Array.from(this.rows.values()).filter(r => r.heap_id === heapId).length;
  }

  async pruneScores(heapId: string): Promise<void> {
    const sorted = Array.from(this.rows.values())
      .filter(r => r.heap_id === heapId)
      .sort((a, b) => b.score - a.score);
    const toDelete = sorted.slice(1000);
    for (const row of toDelete) {
      this.rows.delete(this.key(row.heap_id, row.player_id));
    }
  }

  async getScoresPaginated(heapId: string, offset: number, limit: number): Promise<ScoreRow[]> {
    const rows = Array.from(this.rows.values())
      .filter(r => r.heap_id === heapId)
      .sort((a, b) => b.score - a.score)
      .slice(offset, offset + limit);
    return Promise.all(rows.map(r => this.withJoins(r)));
  }

  async getPlayerScores(playerId: string): Promise<Array<{
    heapId: string; name: string; score: number; rank: number;
  }>> {
    const all = Array.from(this.rows.values());
    const playerRows = all.filter(r => r.player_id === playerId);
    const name = await this.resolveName(playerId);
    return playerRows.map(r => {
      const rank = all.filter(o =>
        o.heap_id === r.heap_id && o.score > r.score
      ).length + 1;
      return { heapId: r.heap_id, name, score: r.score, rank };
    });
  }

  /** Test helper — seed a score row directly. `name` also seeds a shadow
   *  player_name entry (overridden by an attached nameDb if one is set). */
  seed(heapId: string, playerId: string, name: string, score: number): void {
    this.rows.set(this.key(heapId, playerId), {
      heap_id:    heapId,
      player_id:  playerId,
      name:       '',
      score,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
    this.names.set(playerId, name);
  }

  /** Test helper — seed a player_customization row (raw JSON string). */
  seedLoadout(playerId: string, loadoutJson: string): void {
    this.loadouts.set(playerId, loadoutJson);
  }
}
