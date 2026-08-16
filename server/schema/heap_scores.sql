-- server/schema/heap_scores.sql — reference schema for the DB_SCORES database (heap_scores).
-- Final intended state for fresh installs. Source of truth for applies is the
-- migration at server/migrations/heap_scores/. Keep the two in sync.

CREATE TABLE IF NOT EXISTS score (
  heap_id    TEXT    NOT NULL,
  player_id  TEXT    NOT NULL,
  score      INTEGER NOT NULL,
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL,
  PRIMARY KEY (heap_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_score_heap_score ON score (heap_id, score DESC);

CREATE TABLE IF NOT EXISTS player_customization (
  player_id  TEXT NOT NULL PRIMARY KEY,
  loadout    TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS player_auth (
  player_id   TEXT NOT NULL PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS player_contribution (
  heap_id    TEXT    NOT NULL,
  player_id  TEXT    NOT NULL,
  count      INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT    NOT NULL,
  PRIMARY KEY (heap_id, player_id)
);

CREATE TABLE IF NOT EXISTS player_name (
  player_id  TEXT NOT NULL PRIMARY KEY,
  name       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Shadow-ban list. A banned player is filtered out of every other player's
-- leaderboard read and has their heap placements silently dropped, while their
-- own client continues to behave exactly as before. Global, not per-heap: the
-- ban outlives score pruning and can pre-date the player's first score.
CREATE TABLE IF NOT EXISTS player_ban (
  player_id TEXT NOT NULL PRIMARY KEY,
  reason    TEXT,
  banned_at TEXT NOT NULL
);
