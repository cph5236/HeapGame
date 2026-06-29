-- heap_scores / 0001_init.sql
-- Consolidated final-state DDL for the leaderboard domain (single `score` table).
-- Lifted from the original single-DB migration 0001.

-- High scores — one row per (heap, player), enforced by PRIMARY KEY
CREATE TABLE IF NOT EXISTS score (
  heap_id    TEXT    NOT NULL,
  player_id  TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  score      INTEGER NOT NULL,
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL,
  PRIMARY KEY (heap_id, player_id)
);

-- Fast rank queries: COUNT(*) WHERE heap_id=? AND score > ?
CREATE INDEX IF NOT EXISTS idx_score_heap_score ON score (heap_id, score DESC);
