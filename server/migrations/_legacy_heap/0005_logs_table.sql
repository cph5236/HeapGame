-- server/migrations/0005_logs_table.sql
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
