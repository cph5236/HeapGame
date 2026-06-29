CREATE TABLE feedback (
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
