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
