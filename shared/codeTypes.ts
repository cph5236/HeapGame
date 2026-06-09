// shared/codeTypes.ts
//
// Contract shared by the worker (server/src/routes/codes.ts, codeDb.ts), the
// client (src/systems/CodeClient.ts), and tests.

export type RewardType = 'coins' | 'item';

/** What a redeemed code grants. rewardId is set only when rewardType === 'item'. */
export interface RewardPayload {
  rewardType:   RewardType;
  rewardId?:    string;
  rewardAmount: number;
}

/** POST /codes/redeem request body. */
export interface RedeemCodeRequest {
  code:       string;
  playerGuid: string;
}

/** POST /codes/redeem 200 body. */
export type RedeemCodeResponse = RewardPayload;

/** POST /codes (admin) request body. */
export interface CreateCodeRequest {
  code:            string;
  rewardType:      RewardType;
  rewardId?:       string;       // required when rewardType === 'item'
  rewardAmount:    number;
  maxRedemptions?: number;       // 0/undefined = unlimited
  expiresAt?:      string | null; // ISO8601 or null = never
}

/** Persisted row shape (also the GET /codes listing entry). */
export interface RewardCodeRow {
  code:            string;
  reward_type:     RewardType;
  reward_id:       string | null;
  reward_amount:   number;
  max_redemptions: number;
  redeemed_count:  number;
  expires_at:      string | null;
  created_at:      string;
}

/** Discriminated result of a redeem attempt (server-internal). */
export type RedeemOutcome =
  | { kind: 'ok'; reward: RewardPayload }
  | { kind: 'notFound' }
  | { kind: 'expired' }
  | { kind: 'exhausted' }
  | { kind: 'alreadyRedeemed' };
