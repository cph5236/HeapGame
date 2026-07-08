-- Player write-auth: per-player secret hashes, trust-on-first-use.
-- See docs/superpowers/specs/2026-07-07-player-write-auth-design.md
CREATE TABLE IF NOT EXISTS player_auth (
  player_id   TEXT NOT NULL PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
