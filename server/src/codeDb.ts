// server/src/codeDb.ts

import type {
  CreateCodeRequest,
  RewardCodeRow,
  RedeemOutcome,
  RewardType,
} from '../../shared/codeTypes';

/** Normalized, validated mint input (route does the validation). */
export interface NormalizedCreateCode {
  code:            string;        // already UPPERCASE-normalized
  rewardType:      RewardType;
  rewardId:        string | null;
  rewardAmount:    number;
  maxRedemptions:  number;        // 0 = unlimited
  expiresAt:       string | null;
}

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
