-- server/schema.sql

--DROP TABLE IF EXISTS heap;
--DROP TABLE IF EXISTS heap_base;

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

-- Enemy spawn params — one row per heap. Sentinel row provides defaults.
CREATE TABLE IF NOT EXISTS heap_parameters (
  heap_id      TEXT PRIMARY KEY,
  enemy_params TEXT NOT NULL DEFAULT '{}'
);

-- Sentinel row — default enemy params used when a heap has no specific row.
-- heap_id = all-zeros GUID. INSERT OR IGNORE so re-running the schema is safe.
INSERT OR IGNORE INTO heap_parameters (heap_id, enemy_params) VALUES (
  '00000000-0000-0000-0000-000000000000',
  '{"percher":{"spawnStartPxAboveFloor":0,"spawnEndPxAboveFloor":-1,"spawnRampPxAboveFloor":15000,"spawnChanceMin":0.15,"spawnChanceMax":0.45},"ghost":{"spawnStartPxAboveFloor":5000,"spawnEndPxAboveFloor":-1,"spawnRampPxAboveFloor":20000,"spawnChanceMin":0.10,"spawnChanceMax":0.35}}'
);
