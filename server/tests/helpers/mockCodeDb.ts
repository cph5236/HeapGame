// server/tests/helpers/mockCodeDb.ts

import type { RewardCodeDB, NormalizedCreateCode, NormalizedUpdateCode, UpdateCodeOutcome } from '../../src/game/codeDb';
import type { RewardCodeRow, RedeemOutcome } from '../../../shared/codeTypes';

/** In-memory RewardCodeDB for tests. Same outcome semantics as D1RewardCodeDB. */
export class MockCodeDB implements RewardCodeDB {
  private codes = new Map<string, RewardCodeRow>();
  private redemptions = new Set<string>(); // `${code}::${guid}`

  async createCode(req: NormalizedCreateCode, now: string): Promise<boolean> {
    if (this.codes.has(req.code)) return false;
    this.codes.set(req.code, {
      code:            req.code,
      reward_type:     req.rewardType,
      reward_id:       req.rewardId,
      reward_amount:   req.rewardAmount,
      max_redemptions: req.maxRedemptions,
      redeemed_count:  0,
      expires_at:      req.expiresAt,
      created_at:      now,
    });
    return true;
  }

  async getCode(code: string): Promise<RewardCodeRow | null> {
    return this.codes.get(code) ?? null;
  }

  async listCodes(): Promise<RewardCodeRow[]> {
    return [...this.codes.values()].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }

  async updateCode(code: string, patch: NormalizedUpdateCode): Promise<UpdateCodeOutcome> {
    const row = this.codes.get(code);
    if (!row) return 'notFound';
    if (patch.maxRedemptions !== undefined && patch.maxRedemptions !== 0
        && patch.maxRedemptions < row.redeemed_count) {
      return 'maxRedemptionsBelowRedeemed';
    }
    if (patch.rewardAmount !== undefined)   row.reward_amount = patch.rewardAmount;
    if (patch.maxRedemptions !== undefined) row.max_redemptions = patch.maxRedemptions;
    if (patch.expiresAt !== undefined)      row.expires_at = patch.expiresAt;
    return 'ok';
  }

  async deleteCode(code: string): Promise<boolean> {
    for (const key of this.redemptions) {
      if (key.startsWith(code + '::')) this.redemptions.delete(key);
    }
    return this.codes.delete(code);
  }

  async redeem(code: string, playerGuid: string, now: string): Promise<RedeemOutcome> {
    const row = this.codes.get(code);
    if (!row) return { kind: 'notFound' };
    if (row.expires_at && row.expires_at <= now) return { kind: 'expired' };

    const rkey = `${code}::${playerGuid}`;
    if (this.redemptions.has(rkey)) return { kind: 'alreadyRedeemed' };
    if (row.max_redemptions !== 0 && row.redeemed_count >= row.max_redemptions) {
      return { kind: 'exhausted' };
    }

    this.redemptions.add(rkey);
    row.redeemed_count += 1;
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
