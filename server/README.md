# Heap Server

A Cloudflare Worker that serves as the backend for Heap. Built with [Hono](https://hono.dev/) and backed by [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite at the edge), with a [Workers KV](https://developers.cloudflare.com/kv/) read cache over the hot repos.

> **Domain-sharded storage.** What was a single `heap` D1 database is now split into
> four domain-focused databases, plus a KV cache. See
> [`docs/superpowers/plans/2026-06-24-d1-sharding-kv-cache.md`](../docs/superpowers/plans/2026-06-24-d1-sharding-kv-cache.md)
> and the companion runbook for the rationale and the one-time data move.
>
> | Binding | Database | Tables |
> |---|---|---|
> | `DB_HEAP` | `heap_core` | `heap`, `heap_base`, `heap_parameters` |
> | `DB_SCORES` | `heap_scores` | `score` |
> | `DB_REWARDS` | `heap_rewards` | `reward_codes`, `code_redemptions` |
> | `DB_TELEMETRY` | `heap_telemetry` | `logs`, `feedback` |
> | `CACHE` (KV) | — | edge read cache over the heap + score repos |

## Components

| File | Purpose |
|---|---|
| `src/index.ts` | Worker entry point — wires up the four D1 bindings + `CACHE` KV and hands off to `createApp` |
| `src/app.ts` | Hono app factory — mounts `/heaps` and `/scores` route groups |
| `src/db.ts` | `HeapDB` interface + `D1HeapDB` implementation (heap CRUD, live zone, freeze, version CAS) |
| `src/scoreDb.ts` | `ScoreDB` interface + `D1ScoreDB` implementation (leaderboard upsert, rank, prune) |
| `src/cache/CachedHeapDB.ts` | KV cache-aside / write-through decorator over `HeapDB` |
| `src/cache/CachedScoreDB.ts` | KV cache decorator over `ScoreDB` (cached leaderboard top-N) |
| `src/routes/heap.ts` | Heap routes: create, list, get, place block, reset, delete |
| `src/routes/scores.ts` | Score routes: submit score, leaderboard context, paginated leaderboard |
| `src/polygon.ts` | Point-in-polygon check used by the place-block route |
| `schema/<db>.sql` | Per-database reference schema (full intended state, for fresh installs) |
| `schema.sql` | Index only — points at the per-DB `schema/<db>.sql` files |
| `migrations/<db>/` | Incremental SQL migration files per database, applied by Wrangler in order |
| `migrations/_legacy_heap/` | Archived single-DB migrations (pre-split), kept for reference |
| `wrangler.toml` | Worker config — D1 + KV bindings, per-DB migrations dirs, compatibility flags |
| `API_README.md` | Full API reference for all routes |

---

## Local Development

```bash
# From server/ — apply all pending migrations to the local D1 replicas first
for db in heap_core heap_scores heap_rewards heap_telemetry; do
  npx wrangler d1 migrations apply "$db" --local
done

# Then start the worker
npm run dev
```

Starts the worker locally at `http://localhost:8787` using `wrangler dev`. Uses local D1 replicas (one per database) and a local KV store under `.wrangler/state/` — do not commit that directory.

---

## Database Migrations

Each database has its own migrations directory (`migrations/<db>/`). Wrangler tracks which files have been applied per database in a `d1_migrations` table — each file runs exactly once. First decide which domain database the changed table lives in (see the binding table at the top).

### Applying migrations

```bash
# Local dev — loop all four databases
for db in heap_core heap_scores heap_rewards heap_telemetry; do
  npx wrangler d1 migrations apply "$db" --local   # or --remote
done
```

Remote applies also run automatically via `.github/workflows/migrate-d1.yml` on push to `main`. Running the command again on an already-migrated database is safe — already-applied files are skipped.

### Making a schema change

1. **Create a new migration file** under the right database's directory, with the next sequential number for that DB:
   ```
   migrations/heap_core/0002_describe_your_change.sql
   ```
2. **Write only the incremental SQL** — the new `CREATE TABLE`, `ALTER TABLE`, `INSERT`, etc. Do not copy the full schema.
3. **Also update `schema/<db>.sql`** to reflect that database's final intended state. These per-DB files are used as a reference and for setting up fresh environments.
4. **Never edit an already-applied migration.** Write a new one instead.

### Setting up a fresh environment

1. Create the four D1 databases and the KV namespace (or via the Cloudflare dashboard):
   ```bash
   for db in heap_core heap_scores heap_rewards heap_telemetry; do npx wrangler d1 create "$db"; done
   npx wrangler kv namespace create CACHE
   ```
2. Copy each printed `database_id` / KV `id` into the matching binding in `wrangler.toml`
3. Apply all migrations to every database (see **Applying migrations** above, with `--remote`)
4. Deploy the worker: `npm run deploy`

---

## Deploying the Worker

```bash
# From server/
npm run deploy
```

Equivalent to `wrangler deploy`. Bundles `src/index.ts` and pushes to Cloudflare Workers. The four D1 bindings (`DB_HEAP`, `DB_SCORES`, `DB_REWARDS`, `DB_TELEMETRY`) and the `CACHE` KV binding are resolved automatically via `wrangler.toml`.

---

## Security

The Worker is hardened in three layers:

1. **CORS allowlist** — `ALLOWED_ORIGINS` in `wrangler.toml` is a comma-separated list of origins that may call the API from a browser. `*` (default) disables the allowlist for local dev. Tighten to your real production origin(s) before relying on this as a security layer.
2. **Admin secret** — mutating heap routes (`POST /heaps`, `PUT /heaps/:id/reset`, `PUT /heaps/:id/enemy-params`, `DELETE /heaps/:id`) require an `X-Admin-Secret` header matching the `ADMIN_SECRET` Worker secret. Set with `npx wrangler secret put ADMIN_SECRET`. If the secret is unset (local dev) the gate is bypassed. The seed script reads `ADMIN_SECRET` from `process.env` — pass it when running against a production-gated server: `ADMIN_SECRET=<value> npm run seed`.
3. **Per-IP rate limits** — three Workers Rate Limiting API bindings declared in `wrangler.toml`: `RL_SCORES` (10/min on `POST /scores`), `RL_PLACE` (30/min on `POST /heaps/:id/place`), `RL_GLOBAL` (300/min global circuit breaker). Keyed by client IP via `cf-connecting-ip`. Counts are per Cloudflare datacenter per IP.

Read endpoints and `POST /heaps/:id/place` (the only mutating route the game client uses during normal play) are intentionally not gated by the admin secret — the rate limiter is the defense for those.

### Monitoring rate-limit hits

The middleware logs `[ratelimit] blocked label=... ip=... path=...` on every blocked request. To watch live:

```bash
cd server && npx wrangler tail
```

Past blocks also appear in the **Workers → heap-server → Logs** tab in the Cloudflare dashboard, and `429` responses show up on the Worker's status-code analytics chart.

---

## Tests

```bash
# From server/
npm test
```

Tests run against in-memory `MockHeapDB` and `MockScoreDB` — no D1 or network required. See `tests/` for coverage.
