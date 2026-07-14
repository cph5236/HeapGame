import type { ContributionDB } from '../../src/contributionDb';

/** In-memory ContributionDB for tests. Same semantics as D1ContributionDB. */
export class MockContributionDB implements ContributionDB {
  // key: `${heapId} ${playerId}`
  rows = new Map<string, number>();

  private key(heapId: string, playerId: string): string {
    return `${heapId} ${playerId}`;
  }

  async increment(heapId: string, playerId: string, _now: string): Promise<void> {
    const key = this.key(heapId, playerId);
    this.rows.set(key, (this.rows.get(key) ?? 0) + 1);
  }

  async getCount(heapId: string, playerId: string): Promise<number> {
    return this.rows.get(this.key(heapId, playerId)) ?? 0;
  }
}
