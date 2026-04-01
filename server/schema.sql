CREATE TABLE IF NOT EXISTS heap_polygon (
  heap_id   TEXT PRIMARY KEY,
  base_hash TEXT NOT NULL,
  version   INTEGER NOT NULL DEFAULT 1,
  live_zone TEXT    NOT NULL DEFAULT '[]',
  freeze_y  REAL    NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS heap_base (
  hash     TEXT PRIMARY KEY,
  vertices TEXT NOT NULL
);
