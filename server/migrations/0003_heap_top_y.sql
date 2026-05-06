-- Add top_y to track the summit (lowest Y) of each heap.
-- Lower Y = higher in screen coords. Backfilled from each heap's base vertices.
ALTER TABLE heap ADD COLUMN top_y REAL NOT NULL DEFAULT 0;

-- Backfill: pull MIN(y) over the JSON array of vertices on the heap's base row.
UPDATE heap
SET top_y = COALESCE((
  SELECT MIN(json_extract(je.value, '$.y'))
  FROM heap_base hb, json_each(hb.vertices) je
  WHERE hb.id = heap.base_id
), 0);
