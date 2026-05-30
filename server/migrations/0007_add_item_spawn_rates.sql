-- Salvage pickup spawn tuning, per heap.
-- base_item_spawn_rate:     0..1 chance a pickup spawns per surface candidate.
-- positive_item_spawn_rate: weight for choosing a beneficial item when one spawns.
-- negative_item_spawn_rate: weight for choosing a hindering item when one spawns.
ALTER TABLE heap ADD COLUMN base_item_spawn_rate     REAL NOT NULL DEFAULT 0.33;
ALTER TABLE heap ADD COLUMN positive_item_spawn_rate REAL NOT NULL DEFAULT 0.5;
ALTER TABLE heap ADD COLUMN negative_item_spawn_rate REAL NOT NULL DEFAULT 0.5;
