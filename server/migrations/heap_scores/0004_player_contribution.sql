-- Per-(heap, player) placement contribution counter. Ticks server-side when an
-- authenticated /heaps/:id/place is accepted.
CREATE TABLE IF NOT EXISTS player_contribution (
  heap_id    TEXT    NOT NULL,
  player_id  TEXT    NOT NULL,
  count      INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT    NOT NULL,
  PRIMARY KEY (heap_id, player_id)
);
