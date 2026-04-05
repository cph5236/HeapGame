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
  id         TEXT PRIMARY KEY,
  base_id    TEXT NOT NULL,
  live_zone  TEXT NOT NULL DEFAULT '[]',
  freeze_y   REAL NOT NULL DEFAULT 0,
  version    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
