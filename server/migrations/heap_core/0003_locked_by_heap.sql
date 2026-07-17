-- heap_core / 0003_locked_by_heap.sql
-- Heap locking: a heap with locked_by_heap_id set is locked in the client
-- selector until the player beats that prerequisite heap. Nullable, no FK
-- (SQLite ALTER cannot add FKs; the client fails open on dangling pointers).

ALTER TABLE heap ADD COLUMN locked_by_heap_id TEXT;
