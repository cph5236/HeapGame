# Runbook — D1 Sharding + KV Cache rollout (live infrastructure)

Companion to `docs/superpowers/plans/2026-06-24-d1-sharding-kv-cache.md`. The code
changes (wrangler.toml structure, per-DB migrations, cache decorators, `index.ts`
wiring, CI loop) are committed on `feature/d1-sharding-kv-cache`. This runbook
covers the **live, irreversible Cloudflare steps a human must run** — none of it
is automated, and the destructive prod data move is gated on a manual row-count
check.

> Run from `server/`. These commands create/modify real Cloudflare resources and
> need `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (or `wrangler login`).

## 1. Provision the databases + KV namespace

```bash
cd server
npx wrangler d1 create heap_core
npx wrangler d1 create heap_scores
npx wrangler d1 create heap_rewards
npx wrangler d1 create heap_telemetry
npx wrangler kv namespace create CACHE
```

Each command prints an id. Paste them into `server/wrangler.toml`, replacing the
placeholders: `<heap_core-id>`, `<heap_scores-id>`, `<heap_rewards-id>`,
`<heap_telemetry-id>`, and `<cache-namespace-id>`.

## 2. Apply schema migrations

Local (validates the per-DB `0001_init.sql` files against a fresh SQLite):

```bash
cd server
npx wrangler d1 migrations apply heap_core      --local
npx wrangler d1 migrations apply heap_scores     --local
npx wrangler d1 migrations apply heap_rewards    --local
npx wrangler d1 migrations apply heap_telemetry  --local
```

Remote is handled automatically by `.github/workflows/migrate-d1.yml` on push to
`main` (it now loops all four databases), or run the same commands with
`--remote` to apply by hand.

## 3. One-time production data move (DESTRUCTIVE — gated)

Splitting a *populated* DB is export/import, not `ALTER`. **Do not delete the old
`heap` database until per-table row counts match.**

```bash
cd server
# 1. Export the legacy combined DB.
npx wrangler d1 export heap --remote --output heap_dump.sql

# 2. Split the dump into per-domain table subsets (manual / scripted):
#    heap_core      <- heap_base, heap, heap_parameters
#    heap_scores    <- score
#    heap_rewards   <- reward_codes, code_redemptions
#    heap_telemetry <- logs, feedback
#    Import each subset into its new DB:
npx wrangler d1 execute heap_core      --remote --file heap_core_data.sql
npx wrangler d1 execute heap_scores    --remote --file heap_scores_data.sql
npx wrangler d1 execute heap_rewards   --remote --file heap_rewards_data.sql
npx wrangler d1 execute heap_telemetry --remote --file heap_telemetry_data.sql
```

**Verify row counts before retiring the old DB.** For each table compare the count
in the old `heap` DB against the new domain DB, e.g.:

```bash
npx wrangler d1 execute heap      --remote --command "SELECT COUNT(*) FROM score;"
npx wrangler d1 execute heap_scores --remote --command "SELECT COUNT(*) FROM score;"
```

Only once every table's counts match across old → new is it safe to retire the
legacy `heap` database. The legacy single-DB migrations are preserved under
`server/migrations/_legacy_heap/` for reference; they are no longer referenced by
any `wrangler.toml` binding.

## 4. Manual KV cache check (`wrangler dev`)

With real ids in `wrangler.toml`:

```bash
cd server
npx wrangler dev
```

- First `GET /heaps/:id` → served from D1 (cache miss), populates `cache:heap:{id}`.
- Second `GET /heaps/:id` → served from KV (cache hit).
- `POST /heaps/:id/place` → D1 write, then `cache:heap:{id}` + `cache:heap:list`
  deleted; the next read reflects the new `version`.
- Confirm `logs` / `feedback` writes never create `cache:*` keys (telemetry is
  D1-direct by design).
