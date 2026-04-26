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
| `schema.sql` | D1 schema — full intended state, used as reference and for fresh installs |
| `migrations/` | Incremental SQL migration files applied by Wrangler in order |
| `wrangler.toml` | Worker config — name, D1 binding, migrations dir, compatibility flags |
| `API_README.md` | Full API reference for all routes |

---

## Local Development

```bash
# From server/ — apply all pending migrations to local D1 replica first
npx wrangler d1 migrations apply heap-db --local

# Then start the worker
npm run dev
```

Starts the worker locally at `http://localhost:8787` using `wrangler dev`. Uses a local D1 replica stored under `.wrangler/state/` — do not commit that directory.

---

## Database Migrations

Schema changes are managed as numbered SQL files in `migrations/`. Wrangler tracks which files have been applied in a `d1_migrations` table — each file runs exactly once.

### Applying migrations

```bash
# Local dev
npx wrangler d1 migrations apply heap-db --local

# Production
npx wrangler d1 migrations apply heap-db --remote
```

Running the command again on an already-migrated database is safe — already-applied files are skipped.

### Making a schema change

1. **Create a new migration file** with the next sequential number:
   ```
   migrations/0003_describe_your_change.sql
   ```
2. **Write only the incremental SQL** — the new `CREATE TABLE`, `ALTER TABLE`, `INSERT`, etc. Do not copy the full schema.
3. **Also update `schema.sql`** to reflect the final intended state. This file is used as a reference and for setting up fresh environments.
4. **Never edit an already-applied migration.** Write a new one instead.

### Setting up a fresh environment

1. Create the D1 database: `wrangler d1 create heap` (or via the Cloudflare dashboard)
2. Copy the `database_id` into `wrangler.toml`
3. Apply all migrations: `npx wrangler d1 migrations apply heap-db --remote`
4. Deploy the worker: `npm run deploy`

---

## Deploying the Worker

```bash
# From server/
npm run deploy
```

Equivalent to `wrangler deploy`. Bundles `src/index.ts` and pushes to Cloudflare Workers. The D1 binding (`DB`) is resolved automatically via `wrangler.toml`.

---

## Tests

```bash
# From server/
npm test
```

Tests run against in-memory `MockHeapDB` and `MockScoreDB` — no D1 or network required. See `tests/` for coverage.
