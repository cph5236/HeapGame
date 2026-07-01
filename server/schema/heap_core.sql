-- server/schema/heap_core.sql — reference schema for the DB_HEAP database (heap_core).
-- Final intended state for fresh installs. Source of truth for applies is the
-- migration at server/migrations/heap_core/. Keep the two in sync.

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
  world_height    INTEGER NOT NULL DEFAULT 50000,
  top_y           REAL NOT NULL DEFAULT 0,
  ghost_point_count INTEGER NOT NULL DEFAULT 1,
  base_item_spawn_rate     REAL NOT NULL DEFAULT 0.33,
  positive_item_spawn_rate REAL NOT NULL DEFAULT 0.15,
  negative_item_spawn_rate REAL NOT NULL DEFAULT 0.85
);

CREATE TABLE IF NOT EXISTS heap_parameters (
  heap_id      TEXT PRIMARY KEY,
  enemy_params TEXT NOT NULL DEFAULT '{}'
);

INSERT OR IGNORE INTO heap_parameters (heap_id, enemy_params) VALUES (
  '00000000-0000-0000-0000-000000000000',
  '{"percher":{"spawnStartPxAboveFloor":0,"spawnEndPxAboveFloor":-1,"spawnRampPxAboveFloor":15000,"spawnChanceMin":0.15,"spawnChanceMax":0.45},"ghost":{"spawnStartPxAboveFloor":5000,"spawnEndPxAboveFloor":-1,"spawnRampPxAboveFloor":20000,"spawnChanceMin":0.10,"spawnChanceMax":0.35}}'
);

-- Generic global config store. One row per key; value is JSON-encoded.
-- Not per-heap — this is app-wide state (e.g. ad cadence).
CREATE TABLE IF NOT EXISTS app_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO app_config (key, value, updated_at) VALUES (
  'ad_cadence', '{"min":40,"max":50}', datetime('now')
);
