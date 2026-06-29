-- server/schema/heap_telemetry.sql — reference schema for the DB_TELEMETRY database (heap_telemetry).
-- Final intended state for fresh installs. Source of truth for applies is the
-- migration at server/migrations/heap_telemetry/. Keep the two in sync.
-- High-write, append-only; never cached.

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_guid TEXT NOT NULL,
  session_id TEXT NOT NULL,
  level TEXT NOT NULL,
  event_type TEXT,
  message TEXT,
  payload TEXT NOT NULL,
  platform TEXT NOT NULL,
  app_version TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  client_ts INTEGER NOT NULL,
  server_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_user ON logs(user_guid, server_ts DESC);
CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level, server_ts DESC);

CREATE TABLE IF NOT EXISTS feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category    TEXT    NOT NULL,
  player_guid TEXT    NOT NULL,
  session_id  TEXT    NOT NULL DEFAULT '',
  message     TEXT    NOT NULL,
  app_version TEXT    NOT NULL DEFAULT '',
  platform    TEXT    NOT NULL DEFAULT '',
  heap_id     TEXT,
  user_agent  TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL
);
