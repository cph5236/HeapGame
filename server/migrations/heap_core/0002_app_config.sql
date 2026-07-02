-- server/migrations/heap_core/0002_app_config.sql
-- Generic global config store. One row per key; value is JSON-encoded.
-- Not per-heap — this is app-wide state (e.g. ad cadence), unlike `heap`/
-- `heap_parameters` which are keyed by heap_id.

CREATE TABLE IF NOT EXISTS app_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO app_config (key, value, updated_at) VALUES (
  'ad_cadence', '{"min":40,"max":50}', datetime('now')
);
