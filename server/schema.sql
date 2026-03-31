CREATE TABLE IF NOT EXISTS heap_polygon (
  id        INTEGER PRIMARY KEY CHECK (id = 1),
  version   INTEGER NOT NULL DEFAULT 0,
  base_hash TEXT    NOT NULL DEFAULT '',
  live_zone TEXT    NOT NULL DEFAULT '[]',
  freeze_y  REAL    NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS heap_base (
  hash     TEXT PRIMARY KEY,
  vertices TEXT NOT NULL
);

INSERT OR IGNORE INTO heap_polygon (id, version, base_hash, live_zone, freeze_y)
VALUES (1, 0, '', '[]', 0);
