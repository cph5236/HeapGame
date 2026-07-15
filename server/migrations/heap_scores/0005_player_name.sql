-- Dedicated player-name table. Names previously lived per-score-row; renames
-- now write here and leaderboard reads JOIN it. score.name stays (unread,
-- '' on new inserts) until a later cleanup migration drops it.
CREATE TABLE IF NOT EXISTS player_name (
  player_id  TEXT NOT NULL PRIMARY KEY,
  name       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Backfill verbatim (grandfathered — no validation): one row per player,
-- name from their most recently updated score row.
INSERT INTO player_name (player_id, name, updated_at)
SELECT player_id, name, MAX(updated_at) FROM score GROUP BY player_id
ON CONFLICT (player_id) DO NOTHING;
