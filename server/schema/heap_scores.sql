-- server/schema/heap_scores.sql — reference schema for the DB_SCORES database (heap_scores).
-- Final intended state for fresh installs. Source of truth for applies is the
-- migration at server/migrations/heap_scores/. Keep the two in sync.

CREATE TABLE IF NOT EXISTS score (
  heap_id    TEXT    NOT NULL,
  player_id  TEXT    NOT NULL,
  name       TEXT    NOT NULL,
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
