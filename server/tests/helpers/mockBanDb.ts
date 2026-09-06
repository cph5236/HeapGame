import type { BanDB, BanRow } from '../../src/platform/banDb';

/** In-memory BanDB for tests. No D1 or Workers runtime needed. */
export class MockBanDB implements BanDB {
  private rows = new Map<string, BanRow>();

  async isBanned(playerId: string): Promise<boolean> {
    return this.rows.has(playerId);
  }

  async get(playerId: string): Promise<BanRow | null> {
    return this.rows.get(playerId) ?? null;
  }

  async list(): Promise<BanRow[]> {
    return Array.from(this.rows.values())
      .sort((a, b) => b.banned_at.localeCompare(a.banned_at));
  }

  async ban(playerId: string, reason: string | null, now: string): Promise<void> {
    this.rows.set(playerId, { player_id: playerId, reason, banned_at: now });
  }

  async unban(playerId: string): Promise<void> {
    this.rows.delete(playerId);
  }
}
