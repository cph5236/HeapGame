-- server/migrations/heap_scores/0002_player_customization.sql
-- Equipped cosmetic loadout per player (display data only; ownership lives
-- client-side). loadout is a validated JSON object: {"hat":"hat_cone",...}.
CREATE TABLE IF NOT EXISTS player_customization (
  player_id  TEXT NOT NULL PRIMARY KEY,
  loadout    TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
