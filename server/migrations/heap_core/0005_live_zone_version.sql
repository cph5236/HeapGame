-- server/migrations/heap_core/0005_live_zone_version.sql
--
-- live_zone becomes a derived cache of the band envelope, rebuilt on read rather
-- than rewritten on every placement — /place is the path under the 10ms CPU cap,
-- and GET is already absorbed by the KV layer for 60s. This column records which
-- heap version the blob was built from; when it lags, the blob is stale.
ALTER TABLE heap ADD COLUMN live_zone_version INTEGER NOT NULL DEFAULT 0;
