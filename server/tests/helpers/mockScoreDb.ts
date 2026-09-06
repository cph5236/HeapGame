import type { ScoreDB, ScoreRow, AdminScoreRow } from '../../src/game/scoreDb';
import type { PlayerNameDB } from '../../src/platform/playerNameDb';
import type { BanDB } from '../../src/platform/banDb';

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
  private banDb: BanDB | null = null;

  private key(heapId: string, playerId: string): string {
    return `${heapId}::${playerId}`;
  }

  /** Wire an external PlayerNameDB (e.g. shared with a route under test); takes
   *  precedence over names seeded directly via `seed()`. */
  attachNameDb(nameDb: PlayerNameDB): void {
    this.nameDb = nameDb;
  }

  /** Wire an external BanDB; mirrors the D1 LEFT JOIN player_ban. */
  attachBanDb(banDb: BanDB): void {
    this.banDb = banDb;
  }

  private async resolveName(playerId: string): Promise<string> {
    if (this.nameDb) {
      const name = await this.nameDb.getName(playerId);
      if (name !== null) return name;
    }
    return this.names.get(playerId) ?? 'Anonymous';
  }

  /** True when this row must be hidden from `viewerId`. Mirrors the SQL
   *  predicate (b.player_id IS NULL OR s.player_id = ?viewer). */
  private async hidden(playerId: string, viewerId: string): Promise<boolean> {
    if (!this.banDb) return false;
    if (playerId === viewerId) return false;
    return this.banDb.isBanned(playerId);
  }

  /** Rows for a heap, banned players filtered out, ordered by score DESC. */
  private async visibleRows(heapId: string, viewerId: string): Promise<ScoreRow[]> {
    const rows = Array.from(this.rows.values()).filter(r => r.heap_id === heapId);
    const keep: ScoreRow[] = [];
    for (const r of rows) {
      if (!(await this.hidden(r.player_id, viewerId))) keep.push(r);
    }
    return keep.sort((a, b) => b.score - a.score);
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

  async getTopScores(heapId: string, limit: number, viewerId = ''): Promise<ScoreRow[]> {
    const rows = (await this.visibleRows(heapId, viewerId)).slice(0, limit);
    return Promise.all(rows.map(r => this.withJoins(r)));
  }

  async getRank(heapId: string, score: number, viewerId = ''): Promise<number> {
    const rows = await this.visibleRows(heapId, viewerId);
    return rows.filter(r => r.score > score).length + 1;
  }

  async countScores(heapId: string, viewerId = ''): Promise<number> {
    return (await this.visibleRows(heapId, viewerId)).length;
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

  async getScoresPaginated(heapId: string, offset: number, limit: number, viewerId = ''): Promise<ScoreRow[]> {
    const rows = (await this.visibleRows(heapId, viewerId)).slice(offset, offset + limit);
    return Promise.all(rows.map(r => this.withJoins(r)));
  }

  async getPlayerScores(playerId: string): Promise<Array<{
    heapId: string; name: string; score: number; rank: number;
  }>> {
    const playerRows = Array.from(this.rows.values()).filter(r => r.player_id === playerId);
    const name = await this.resolveName(playerId);
    const out: Array<{ heapId: string; name: string; score: number; rank: number }> = [];
    for (const r of playerRows) {
      const visible = await this.visibleRows(r.heap_id, playerId);
      const rank = visible.filter(o => o.score > r.score).length + 1;
      out.push({ heapId: r.heap_id, name, score: r.score, rank });
    }
    return out;
  }

  async listScoresForAdmin(heapId: string, offset: number, limit: number): Promise<AdminScoreRow[]> {
    const rows = Array.from(this.rows.values())
      .filter(r => r.heap_id === heapId)
      .sort((a, b) => b.score - a.score)
      .slice(offset, offset + limit);
    return Promise.all(rows.map(async r => ({
      ...(await this.withJoins(r)),
      banned: this.banDb ? await this.banDb.isBanned(r.player_id) : false,
    })));
  }

  async countAllScores(heapId: string): Promise<number> {
    return Array.from(this.rows.values()).filter(r => r.heap_id === heapId).length;
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
