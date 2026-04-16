# Heap Server

A Cloudflare Worker that serves as the backend for Heap. Built with [Hono](https://hono.dev/) and backed by [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite at the edge).

## Components

| File | Purpose |
|---|---|
| `src/index.ts` | Worker entry point — wires up D1 bindings and hands off to `createApp` |
| `src/app.ts` | Hono app factory — mounts `/heaps` and `/scores` route groups |
| `src/db.ts` | `HeapDB` interface + `D1HeapDB` implementation (heap CRUD, live zone, freeze) |
| `src/scoreDb.ts` | `ScoreDB` interface + `D1ScoreDB` implementation (leaderboard upsert, rank, prune) |
| `src/routes/heap.ts` | Heap routes: create, list, get, place block, reset, delete |
| `src/routes/scores.ts` | Score routes: submit score, leaderboard context, paginated leaderboard |
| `src/polygon.ts` | Point-in-polygon check used by the place-block route |
| `schema.sql` | D1 schema — all `CREATE TABLE IF NOT EXISTS` and index definitions |
| `wrangler.toml` | Worker config — name, D1 binding, compatibility flags |
| `API_README.md` | Full API reference for all routes |

---

## Local Development

```bash
# From server/
npm run dev
```

Starts the worker locally at `http://localhost:8787` using `wrangler dev`. Uses a local D1 replica stored under `.wrangler/state/` — do not commit that directory.

---

## Deploying the D1 Database

The schema must be applied to the remote D1 instance before or after deploying the worker. The schema is fully idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`) so it is safe to re-run.

### Apply schema to remote D1

```bash
# From server/
npx wrangler d1 execute heap --remote --file=schema.sql
```

- `heap` is the database name from `wrangler.toml` (`database_name = "heap"`)
- `--remote` targets the live Cloudflare D1 instance (omit to target the local replica)
- `--file=schema.sql` points at the schema file relative to the current directory

### Apply schema to local D1 (for resetting dev state)

```bash
npx wrangler d1 execute heap --local --file=schema.sql
```

### Drop and recreate tables (destructive — dev only)

The `DROP TABLE` statements at the top of `schema.sql` are commented out. Uncomment them temporarily if you need to wipe and rebuild from scratch:

```sql
-- Uncomment these two lines in schema.sql, run the command, then recomment them
DROP TABLE IF EXISTS heap;
DROP TABLE IF EXISTS heap_base;
```

---

## Deploying the Worker

```bash
# From server/
npm run deploy
```

Equivalent to `wrangler deploy`. Bundles `src/index.ts` and pushes to Cloudflare Workers. The D1 binding (`DB`) is resolved automatically via `wrangler.toml`.

### Order of operations for a fresh environment

1. Create the D1 database in the Cloudflare dashboard (or `wrangler d1 create heap`)
2. Copy the `database_id` into `wrangler.toml`
3. Apply the schema: `npx wrangler d1 execute heap --remote --file=schema.sql`
4. Deploy the worker: `npm run deploy`

---

## Tests

```bash
# From server/
npm test
```

Tests run against in-memory `MockHeapDB` and `MockScoreDB` — no D1 or network required. See `tests/` for coverage.
