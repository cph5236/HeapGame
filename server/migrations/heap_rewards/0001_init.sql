-- heap_rewards / 0001_init.sql
-- Consolidated final-state DDL for the transactional reward-code domain.
-- The two tables are batched atomically in D1RewardCodeDB.redeem(), so they
-- MUST stay co-located in the same database. Lifted from migration 0008.

CREATE TABLE IF NOT EXISTS reward_codes (
  code            TEXT PRIMARY KEY,          -- normalized UPPERCASE
  reward_type     TEXT NOT NULL,             -- 'coins' | 'item'
  reward_id       TEXT,                       -- item id when type='item', NULL for coins
  reward_amount   INTEGER NOT NULL,           -- coin count, or item quantity
  max_redemptions INTEGER NOT NULL DEFAULT 0, -- 0 = unlimited; 1 = one-time; N = capped
  redeemed_count  INTEGER NOT NULL DEFAULT 0,
  expires_at      TEXT,                        -- nullable ISO8601; NULL = never
  created_at      TEXT NOT NULL,
  -- Enforces the cap in the write path: an increment past the cap aborts the
  -- transaction, so two players racing for the last slot cannot oversubscribe.
  CHECK (max_redemptions = 0 OR redeemed_count <= max_redemptions)
);

CREATE TABLE IF NOT EXISTS code_redemptions (
  code        TEXT NOT NULL,
  player_guid TEXT NOT NULL,
  redeemed_at TEXT NOT NULL,
  PRIMARY KEY (code, player_guid)   -- one redemption per player
);
