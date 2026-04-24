-- Migration 001: add world_height to heap table
-- Existing rows receive the default of 50 000 (the original world height).
-- New heaps created after the world-height expansion should pass worldHeight = 5 000 000.
ALTER TABLE heap ADD COLUMN world_height INTEGER NOT NULL DEFAULT 50000;
