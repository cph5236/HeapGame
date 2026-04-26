CREATE TABLE IF NOT EXISTS heap_base (
  id          TEXT PRIMARY KEY,
  heap_id     TEXT NOT NULL,
  vertices    TEXT NOT NULL,
  vertex_hash TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS heap (
  id              TEXT PRIMARY KEY,
  base_id         TEXT NOT NULL,
  live_zone       TEXT NOT NULL DEFAULT '[]',
  freeze_y        REAL NOT NULL DEFAULT 0,
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  name            TEXT NOT NULL DEFAULT 'Unnamed Heap',
  difficulty      REAL NOT NULL DEFAULT 1.0,
  spawn_rate_mult REAL NOT NULL DEFAULT 1.0,
  coin_mult       REAL NOT NULL DEFAULT 1.0,
  score_mult      REAL NOT NULL DEFAULT 1.0,
  world_height    INTEGER NOT NULL DEFAULT 50000
);

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
