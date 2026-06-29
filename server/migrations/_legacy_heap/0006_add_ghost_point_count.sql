-- Adds ghost_point_count column to heap. DEFAULT 1 backfills all existing rows
-- automatically — no separate UPDATE needed.
ALTER TABLE heap ADD COLUMN ghost_point_count INTEGER NOT NULL DEFAULT 1;
