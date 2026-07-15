import type { PlayerNameDB } from '../../src/playerNameDb';

/** In-memory PlayerNameDB for tests. Same semantics as D1PlayerNameDB. */
export class MockPlayerNameDB implements PlayerNameDB {
  rows = new Map<string, string>();

  async getName(playerId: string): Promise<string | null> {
    return this.rows.get(playerId) ?? null;
  }

  async setName(playerId: string, name: string, _now: string): Promise<void> {
    this.rows.set(playerId, name);
  }
}
