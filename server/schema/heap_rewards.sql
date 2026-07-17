-- server/schema/heap_rewards.sql — reference schema for the DB_REWARDS database (heap_rewards).
-- Final intended state for fresh installs. Source of truth for applies is the
-- migration at server/migrations/heap_rewards/. Keep the two in sync.
-- reward_codes + code_redemptions are batched atomically in redeem() — co-located.

CREATE TABLE IF NOT EXISTS reward_codes (
  code            TEXT PRIMARY KEY,
  reward_type     TEXT NOT NULL,
  reward_id       TEXT,
  reward_amount   INTEGER NOT NULL,
  max_redemptions INTEGER NOT NULL DEFAULT 0,
  redeemed_count  INTEGER NOT NULL DEFAULT 0,
  expires_at      TEXT,
  created_at      TEXT NOT NULL,
  CHECK (max_redemptions = 0 OR redeemed_count <= max_redemptions)
);

CREATE TABLE IF NOT EXISTS code_redemptions (
  code        TEXT NOT NULL,
  player_guid TEXT NOT NULL,
  redeemed_at TEXT NOT NULL,
  PRIMARY KEY (code, player_guid)
);

-- heap_rewards / 0002_daily_claims.sql
-- Daily Drop: one row per player tracking the most recent daily claim.
-- last_claim_at is the server-clock instant (unix ms); the client-reported
-- UTC offset used for that claim is kept for debuggability only.

CREATE TABLE IF NOT EXISTS daily_claims (
  player_id             TEXT PRIMARY KEY,   -- effective player id (GPGS id or GUID)
  last_claim_at         INTEGER NOT NULL,   -- unix ms, server clock
  last_claim_offset_min INTEGER NOT NULL,   -- clamped client UTC offset at claim time
  streak_day            INTEGER NOT NULL,   -- 1..7, day most recently claimed
  total_claims          INTEGER NOT NULL DEFAULT 0  -- lifetime counter (v2 can cosmetics)
);
