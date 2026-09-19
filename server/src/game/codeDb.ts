// server/src/codeDb.ts

import type {
  CreateCodeRequest,
  RewardCodeRow,
  RedeemOutcome,
  RewardType,
} from '../../../shared/codeTypes';

/** Normalized, validated mint input (route does the validation). */
export interface NormalizedCreateCode {
  code:            string;        // already UPPERCASE-normalized
  rewardType:      RewardType;
  rewardId:        string | null;
  rewardAmount:    number;
  maxRedemptions:  number;        // 0 = unlimited
  expiresAt:       string | null;
}

/** Normalized, validated update input (route does the validation). Only the
 *  fields present are changed — identity fields (code/rewardType/rewardId)
 *  are immutable once minted. */
export interface NormalizedUpdateCode {
  rewardAmount?:   number;
  maxRedemptions?: number;
  expiresAt?:      string | null;
}

/** Outcome of an update attempt. `maxRedemptionsBelowRedeemed` covers both a
 *  route-level pre-check and — since a redemption can land between that
 *  check and the write — the table's own CHECK constraint tripping at write
 *  time; either way the caller gets a clean 400 instead of a raw DB error. */
export type UpdateCodeOutcome = 'ok' | 'notFound' | 'maxRedemptionsBelowRedeemed';

/**
 * Abstraction over D1 for reward-code operations. Allows MockCodeDB in tests.
 */
export interface RewardCodeDB {
  /** Insert a new code. Returns false if the code already exists. */
  createCode(req: NormalizedCreateCode, now: string): Promise<boolean>;

  /** Fetch one code row, or null. */
  getCode(code: string): Promise<RewardCodeRow | null>;

  /** All code rows (admin listing), newest first. */
  listCodes(): Promise<RewardCodeRow[]>;

  /** Patch reward amount / cap / expiry on an existing code. */
  updateCode(code: string, patch: NormalizedUpdateCode): Promise<UpdateCodeOutcome>;

  /** Delete a code outright. Returns false if not found. */
  deleteCode(code: string): Promise<boolean>;

  /**
   * Atomically redeem `code` for `playerGuid`. Returns a discriminated outcome.
   * Replay (same player) and cap (across players) are both enforced in the
   * write path — see the batch + CHECK constraint below.
   */
  redeem(code: string, playerGuid: string, now: string): Promise<RedeemOutcome>;
}

/** Production implementation backed by Cloudflare D1. */
export class D1RewardCodeDB implements RewardCodeDB {
  constructor(private d1: D1Database) {}

  async createCode(req: NormalizedCreateCode, now: string): Promise<boolean> {
    try {
      await this.d1
        .prepare(
          `INSERT INTO reward_codes
             (code, reward_type, reward_id, reward_amount, max_redemptions, redeemed_count, expires_at, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7)`,
        )
        .bind(req.code, req.rewardType, req.rewardId, req.rewardAmount, req.maxRedemptions, req.expiresAt, now)
        .run();
      return true;
    } catch (e) {
      // PRIMARY KEY conflict ⇒ duplicate code.
      if (/UNIQUE|PRIMARY KEY/i.test(String((e as Error)?.message ?? e))) return false;
      throw e;
    }
  }

  async getCode(code: string): Promise<RewardCodeRow | null> {
    const row = await this.d1
      .prepare('SELECT * FROM reward_codes WHERE code = ?1')
      .bind(code)
      .first<RewardCodeRow>();
    return row ?? null;
  }

  async listCodes(): Promise<RewardCodeRow[]> {
    const res = await this.d1
      .prepare('SELECT * FROM reward_codes ORDER BY created_at DESC')
      .all<RewardCodeRow>();
    return res.results;
  }

  async updateCode(code: string, patch: NormalizedUpdateCode): Promise<UpdateCodeOutcome> {
    const sets: string[] = [];
    const binds: unknown[] = [];
    let i = 1;
    if (patch.rewardAmount !== undefined)   { sets.push(`reward_amount = ?${i++}`);   binds.push(patch.rewardAmount); }
    if (patch.maxRedemptions !== undefined) { sets.push(`max_redemptions = ?${i++}`); binds.push(patch.maxRedemptions); }
    if (patch.expiresAt !== undefined)      { sets.push(`expires_at = ?${i++}`);      binds.push(patch.expiresAt); }
    if (!sets.length) return (await this.getCode(code)) !== null ? 'ok' : 'notFound';

    binds.push(code);
    try {
      const res = await this.d1
        .prepare(`UPDATE reward_codes SET ${sets.join(', ')} WHERE code = ?${i}`)
        .bind(...binds)
        .run();
      return res.meta.changes > 0 ? 'ok' : 'notFound';
    } catch (e) {
      // A redemption landing between a caller's pre-check and this write can
      // still trip the table's own CHECK(max_redemptions = 0 OR redeemed_count
      // <= max_redemptions) — same constraint redeem() maps below.
      if (/CHECK/i.test(String((e as Error)?.message ?? e))) return 'maxRedemptionsBelowRedeemed';
      throw e;
    }
  }

  async deleteCode(code: string): Promise<boolean> {
    // code_redemptions has no FK back to reward_codes, so it must be purged
    // explicitly — otherwise a re-minted code with the same text inherits the
    // deleted code's redemption history and wrongly locks out players who
    // never touched the new code.
    const res = await this.d1.batch([
      this.d1.prepare('DELETE FROM code_redemptions WHERE code = ?1').bind(code),
      this.d1.prepare('DELETE FROM reward_codes WHERE code = ?1').bind(code),
    ]);
    return res[1].meta.changes > 0;
  }

  async redeem(code: string, playerGuid: string, now: string): Promise<RedeemOutcome> {
    const row = await this.getCode(code);
    if (!row) return { kind: 'notFound' };
    if (row.expires_at && row.expires_at <= now) return { kind: 'expired' };

    try {
      // Atomic transaction. INSERT trips the PK on same-player replay; the
      // UPDATE trips the CHECK constraint if it would exceed the cap. Either
      // failure rolls the whole batch back.
      await this.d1.batch([
        this.d1
          .prepare('INSERT INTO code_redemptions (code, player_guid, redeemed_at) VALUES (?1, ?2, ?3)')
          .bind(code, playerGuid, now),
        this.d1
          .prepare('UPDATE reward_codes SET redeemed_count = redeemed_count + 1 WHERE code = ?1')
          .bind(code),
      ]);
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (/UNIQUE|PRIMARY KEY/i.test(msg)) return { kind: 'alreadyRedeemed' };
      if (/CHECK/i.test(msg))              return { kind: 'exhausted' };
      throw e;
    }

    return {
      kind: 'ok',
      reward: {
        rewardType:   row.reward_type,
        rewardId:     row.reward_id ?? undefined,
        rewardAmount: row.reward_amount,
      },
    };
  }
}
