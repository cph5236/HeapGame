import type { ScoreDB, ScoreRow } from '../../src/scoreDb';

/**
 * In-memory ScoreDB for use in tests. No D1 or Workers runtime needed.
 */
export class MockScoreDB implements ScoreDB {
  // key: `${heapId}::${playerId}`
  private rows = new Map<string, ScoreRow>();

  private key(heapId: string, playerId: string): string {
    return `${heapId}::${playerId}`;
  }

  async getScore(heapId: string, playerId: string): Promise<ScoreRow | null> {
    return this.rows.get(this.key(heapId, playerId)) ?? null;
  }

  async upsertScore(heapId: string, playerId: string, name: string, score: number, now: string): Promise<boolean> {
    const existing = await this.getScore(heapId, playerId);
    if (existing && score <= existing.score) return false;

    this.rows.set(this.key(heapId, playerId), {
      heap_id:    heapId,
      player_id:  playerId,
      name,
      score,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    });
    return true;
  }

  async getTopScores(heapId: string, limit: number): Promise<ScoreRow[]> {
    return Array.from(this.rows.values())
      .filter(r => r.heap_id === heapId)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
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
    return Array.from(this.rows.values())
      .filter(r => r.heap_id === heapId)
      .sort((a, b) => b.score - a.score)
      .slice(offset, offset + limit);
  }

  /** Test helper — seed a score row directly. */
  seed(heapId: string, playerId: string, name: string, score: number): void {
    this.rows.set(this.key(heapId, playerId), {
      heap_id:    heapId,
      player_id:  playerId,
      name,
      score,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
  }
}
