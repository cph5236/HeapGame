import type { PlayerAuthDB } from '../../src/playerAuthDb';

/** In-memory PlayerAuthDB for tests. Same semantics as D1PlayerAuthDB. */
export class MockPlayerAuthDB implements PlayerAuthDB {
  rows = new Map<string, string>();

  async getSecretHash(playerId: string): Promise<string | null> {
    return this.rows.get(playerId) ?? null;
  }

  async insert(playerId: string, secretHash: string, _now: string): Promise<void> {
    if (!this.rows.has(playerId)) this.rows.set(playerId, secretHash);
  }

  async delete(playerId: string): Promise<void> {
    this.rows.delete(playerId);
  }
}
