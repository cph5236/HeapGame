-- Re-backfill top_y for any heap rows where it was left at the default 0.
-- The 0003 migration backfilled existing rows, but heaps created between the
-- migration applying and the createHeap code update receiving the new
-- initialTopY logic would have got the column default (0) and never been
-- corrected. This migration patches them by re-running the same MIN(y) lookup
-- on the heap's base vertices.
--
-- Filtered to rows where top_y = 0 so it's a no-op on already-correct rows.
-- Safe to run repeatedly (Wrangler tracks d1_migrations regardless).

UPDATE heap
SET top_y = COALESCE((
  SELECT MIN(json_extract(je.value, '$.y'))
  FROM heap_base hb, json_each(hb.vertices) je
  WHERE hb.id = heap.base_id
), 0)
WHERE top_y = 0;
