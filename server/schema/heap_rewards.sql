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
