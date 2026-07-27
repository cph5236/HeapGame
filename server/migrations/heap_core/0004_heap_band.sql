-- server/migrations/heap_core/0004_heap_band.sql
--
-- The band envelope becomes the heap's authoritative shape: for each 20px band,
-- the leftmost and rightmost x. Backfilled from the existing live_zone and base
-- vertex blobs, which is lossless — the client already renders only these two
-- extents per band.

CREATE TABLE IF NOT EXISTS heap_band (
  heap_id TEXT    NOT NULL,
  band    INTEGER NOT NULL,
  min_x   REAL    NOT NULL,
  max_x   REAL    NOT NULL,
  version INTEGER NOT NULL,
  PRIMARY KEY (heap_id, band)
);

-- Deltas select bands changed since a client's version.
CREATE INDEX IF NOT EXISTS idx_heap_band_version ON heap_band(heap_id, version);

-- Backfill from the live zone. json_each unnests the blob; y/20 truncates to the
-- band (y is validated non-negative, so truncation == floor).
--
-- MIN/MAX on conflict, NOT "DO NOTHING": base and live-zone vertices can share a
-- band at the freeze boundary, and DO NOTHING would keep whichever array was
-- inserted first and silently discard the other's extent — a wrong envelope on
-- exactly the bands where the two arrays meet.
INSERT INTO heap_band (heap_id, band, min_x, max_x, version)
SELECT h.id,
       CAST(json_extract(v.value, '$.y') / 20 AS INTEGER),
       MIN(json_extract(v.value, '$.x')),
       MAX(json_extract(v.value, '$.x')),
       h.version
FROM heap h, json_each(h.live_zone) v
GROUP BY h.id, CAST(json_extract(v.value, '$.y') / 20 AS INTEGER)
ON CONFLICT(heap_id, band) DO UPDATE SET
  min_x = MIN(min_x, excluded.min_x),
  max_x = MAX(max_x, excluded.max_x);

-- Backfill from the base the heap currently points at.
INSERT INTO heap_band (heap_id, band, min_x, max_x, version)
SELECT h.id,
       CAST(json_extract(v.value, '$.y') / 20 AS INTEGER),
       MIN(json_extract(v.value, '$.x')),
       MAX(json_extract(v.value, '$.x')),
       h.version
FROM heap h
JOIN heap_base b ON b.id = h.base_id, json_each(b.vertices) v
GROUP BY h.id, CAST(json_extract(v.value, '$.y') / 20 AS INTEGER)
ON CONFLICT(heap_id, band) DO UPDATE SET
  min_x = MIN(min_x, excluded.min_x),
  max_x = MAX(max_x, excluded.max_x);
