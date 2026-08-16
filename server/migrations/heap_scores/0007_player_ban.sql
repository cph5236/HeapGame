-- Shadow-ban list. A banned player is filtered out of every other player's
-- leaderboard read and has their heap placements silently dropped, while their
-- own client continues to behave exactly as before. Global, not per-heap: the
-- ban outlives score pruning and can pre-date the player's first score.
CREATE TABLE IF NOT EXISTS player_ban (
  player_id TEXT NOT NULL PRIMARY KEY,
  reason    TEXT,
  banned_at TEXT NOT NULL
);
