-- heap_telemetry / 0001_init.sql
-- Consolidated final-state DDL for the high-write, append-only telemetry domain.
-- Never on a hot read path and never cached. Lifted from migrations 0005 (logs)
-- and 0009 (feedback).

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
