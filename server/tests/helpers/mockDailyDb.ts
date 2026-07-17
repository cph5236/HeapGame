// server/tests/helpers/mockDailyDb.ts

import type { DailyClaimDB, DailyClaimRow } from '../../src/dailyDb';

/** In-memory DailyClaimDB with the same conditional-write semantics as D1. */
export class MockDailyDb implements DailyClaimDB {
  private rows = new Map<string, DailyClaimRow>();

  async get(playerId: string): Promise<DailyClaimRow | null> {
    const row = this.rows.get(playerId);
    return row ? { ...row } : null;
  }

  async record(
    playerId: string,
    nowMs: number,
    offsetMin: number,
    streakDay: number,
    expectedLastClaimAt: number | null,
  ): Promise<boolean> {
    const existing = this.rows.get(playerId);
    if (expectedLastClaimAt === null) {
      if (existing) return false;
      this.rows.set(playerId, {
        player_id: playerId, last_claim_at: nowMs, last_claim_offset_min: offsetMin,
        streak_day: streakDay, total_claims: 1,
      });
      return true;
    }
    if (!existing || existing.last_claim_at !== expectedLastClaimAt) return false;
    this.rows.set(playerId, {
      player_id: playerId, last_claim_at: nowMs, last_claim_offset_min: offsetMin,
      streak_day: streakDay, total_claims: existing.total_claims + 1,
    });
    return true;
  }
}
