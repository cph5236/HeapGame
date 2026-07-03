import type { CustomizationDB } from '../../src/customizationDb';

/** In-memory CustomizationDB for tests. */
export class MockCustomizationDB implements CustomizationDB {
  private rows = new Map<string, string>();

  async getLoadout(playerId: string): Promise<string | null> {
    return this.rows.get(playerId) ?? null;
  }

  async upsertLoadout(playerId: string, loadoutJson: string, _now: string): Promise<void> {
    this.rows.set(playerId, loadoutJson);
  }

  /** Test helper — seed a raw loadout JSON string directly. */
  seed(playerId: string, loadoutJson: string): void {
    this.rows.set(playerId, loadoutJson);
  }
}
