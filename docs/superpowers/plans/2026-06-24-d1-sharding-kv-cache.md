# D1 Domain Sharding + Workers KV Write-Through Cache — Implementation Plan

**Goal:** Split the single mixed D1 database (`heap`) into four domain-focused D1 databases,
and add a Workers KV cache-aside / write-through layer over the read-heavy repositories — to
cut raw D1 row reads on hot paths while keeping writes immediately consistent.

**Architecture:** Cloudflare Worker (Hono) → four D1 databases grouped by domain + one KV
namespace as an edge read cache. Caching is implemented as **decorators** over the existing
`HeapDB` / `ScoreDB` repository interfaces, so routes and tests are unchanged.

**Tech Stack:** TypeScript 5.9, Cloudflare Workers, Hono, D1 (SQLite), Workers KV, Vitest,
GitHub Actions.

> **Status:** Design/plan only. This document is reviewed and merged to `main` first; the
> actual config/migration/code changes ship in a follow-up PR.

---

## Why this change

The backend is one Worker bound to a single D1 database (binding `DB`, db `heap`) that mixes
eight tables with very different access profiles: read-heavy game state, a leaderboard,
transactional reward codes, and high-write append-only telemetry. Every request hits D1 raw
rows — there is no cache, so hot heaps are re-read on every request. We want (1) domain
sharding for independent scaling and blast-radius isolation, and (2) a KV read cache to cut D1
reads while writes stay consistent.

### Established facts (from the current codebase)
- **No SQL `JOIN`s exist anywhere.** The score route reads `heap.score_mult` via a separate
  `getHeap()` call (`server/src/routes/scores.ts`), so `score` can live in its own database.
- **Two hard co-location constraints from atomic `d1.batch()`** (a batch cannot span databases):
  - `heap` + `heap_base` — batched in `D1HeapDB.createHeap()` / `.deleteHeap()` (`server/src/db.ts:95,147`).
  - `reward_codes` + `code_redemptions` — batched in `D1RewardCodeDB.redeem()` (`server/src/codeDb.ts`).
- **Clean repository abstraction already exists**: `HeapDB`/`ScoreDB`/`RewardCodeDB`/`FeedbackDB`
  interfaces each have a `D1*` impl and an in-memory `Mock*` impl used by tests. Caching plugs in
  as a decorator at this seam — no route/test changes.
- Bindings are wired in `server/src/index.ts:29-43`; `Env` is at `index.ts:10-22`.

---

## Domain boundaries (4 databases)

| Binding | Database | Tables | Profile |
|---|---|---|---|
| `DB_HEAP` | `heap_core` | `heap`, `heap_base`, `heap_parameters` | Read-heavy game world; prime KV target |
| `DB_SCORES` | `heap_scores` | `score` | Leaderboard; bursty writes, read-heavy reads |
| `DB_REWARDS` | `heap_rewards` | `reward_codes`, `code_redemptions` | Transactional (atomic batch) |
| `DB_TELEMETRY` | `heap_telemetry` | `logs`, `feedback` | High-write, append-only; never on hot read path |

Honors every sharding rule: no cross-DB joins (none exist), both atomic-batch pairs stay
co-located, and the highest-write tables (`logs`/`feedback`) are isolated from stable
read-heavy tables.

---

## Global Constraints

- **Branch:** `feature/d1-sharding-kv-cache` for the follow-up implementation; PR before merge,
  never push direct to `main`.
- **Build gate:** run `npm run build` before claiming any task done (catches TS errors tests miss).
- **D1 migrations:** add `server/migrations/<db>/NNNN_*.sql` (incremental only) **and** update the
  per-DB reference schema; never edit an applied migration — write a new one.
- **Never commit** `.wrangler/state/`.
- **KV rate limit:** respect 1 write/sec/key. Never use KV to buffer/queue inbound writes —
  `logs`/`feedback` stay D1-direct.

---

## File Map

**Create (follow-up PR):**
- `server/src/cache/CachedHeapDB.ts` — KV decorator implementing `HeapDB`.
- `server/src/cache/CachedScoreDB.ts` — KV decorator implementing `ScoreDB`.
- `server/migrations/heap_core/`, `heap_scores/`, `heap_rewards/`, `heap_telemetry/` — per-DB migration dirs.

**Modify (follow-up PR):**
- `server/wrangler.toml` — four `[[d1_databases]]` bindings + `[[kv_namespaces]]` CACHE binding.
- `server/src/index.ts` — `Env` (four D1 bindings + `CACHE`), compose decorators, thread `ctx.waitUntil`.
- `server/schema.sql` — split into the four domain reference schemas.
- `.github/workflows/migrate-d1.yml` — loop `wrangler d1 migrations apply` over the four databases.

---

## Task 1 — Provision databases + `wrangler.toml`

- [ ] **Create the D1 databases and KV namespace**
  ```bash
  cd server
  npx wrangler d1 create heap_core
  npx wrangler d1 create heap_scores
  npx wrangler d1 create heap_rewards
  npx wrangler d1 create heap_telemetry
  npx wrangler kv namespace create CACHE
  ```

- [ ] **Replace the single D1 block in `server/wrangler.toml`**
  ```toml
  [[d1_databases]]
  binding = "DB_HEAP"
  database_name = "heap_core"
  database_id = "<id>"
  migrations_dir = "migrations/heap_core"

  [[d1_databases]]
  binding = "DB_SCORES"
  database_name = "heap_scores"
  database_id = "<id>"
  migrations_dir = "migrations/heap_scores"

  [[d1_databases]]
  binding = "DB_REWARDS"
  database_name = "heap_rewards"
  database_id = "<id>"
  migrations_dir = "migrations/heap_rewards"

  [[d1_databases]]
  binding = "DB_TELEMETRY"
  database_name = "heap_telemetry"
  database_id = "<id>"
  migrations_dir = "migrations/heap_telemetry"

  [[kv_namespaces]]
  binding = "CACHE"
  id = "<id>"
  ```

---

## Task 2 — Split migrations + one-time data copy

- [ ] **Reorganize migrations into per-DB subdirs** with consolidated `CREATE TABLE` DDL lifted
  from the current `server/schema.sql`:
  ```
  server/migrations/heap_core/0001_init.sql       # heap_base, heap, heap_parameters (+indexes, sentinel row)
  server/migrations/heap_scores/0001_init.sql     # score (+ idx_score_heap_score)
  server/migrations/heap_rewards/0001_init.sql    # reward_codes, code_redemptions (+ CHECK)
  server/migrations/heap_telemetry/0001_init.sql  # logs (+ 2 indexes), feedback
  ```
  Each `0001_init.sql` is the full current DDL for its tables so fresh installs work.

- [ ] **Apply locally and verify**
  ```bash
  cd server
  npx wrangler d1 migrations apply heap_core --local
  npx wrangler d1 migrations apply heap_scores --local
  npx wrangler d1 migrations apply heap_rewards --local
  npx wrangler d1 migrations apply heap_telemetry --local
  ```

- [ ] **One-time prod data move** (splitting a *populated* DB is export/import, not `ALTER`):
  `npx wrangler d1 export heap --remote` the old DB, import each domain's table subset into the
  new DB, then **verify row counts** per table before retiring the old `heap` database. Document
  this as a runbook step; do not delete the old DB until counts match.

---

## Task 3 — KV write-through cache decorators

- [ ] **`server/src/cache/CachedHeapDB.ts`** — cache-aside reads, write-through invalidation.
  Keys: `cache:heap:{id}`, `cache:heap:list`, `cache:base:{baseId}` (immutable, long TTL).
  ```ts
  import type { HeapDB, HeapRow } from '../db';
  import type { Vertex } from '../../../shared/heapTypes';

  const TTL = 60; // live_zone changes on placement → short TTL + invalidate-on-write

  export class CachedHeapDB implements HeapDB {
    constructor(
      private inner: HeapDB,
      private kv: KVNamespace,
      private waitUntil: (p: Promise<unknown>) => void,
    ) {}

    async getHeap(id: string): Promise<HeapRow | null> {
      const key = `cache:heap:${id}`;
      const hit = await this.kv.get<HeapRow>(key, 'json');
      if (hit) return hit;                                  // KV hit
      const row = await this.inner.getHeap(id);             // miss → D1
      if (row) this.waitUntil(this.kv.put(key, JSON.stringify(row), { expirationTtl: TTL }));
      return row;
    }

    async getBaseVerticesById(baseId: string): Promise<Vertex[] | null> {
      const key = `cache:base:${baseId}`;                  // base vertices are immutable
      const hit = await this.kv.get<Vertex[]>(key, 'json');
      if (hit) return hit;
      const v = await this.inner.getBaseVerticesById(baseId);
      if (v) this.waitUntil(this.kv.put(key, JSON.stringify(v), { expirationTtl: 86_400 }));
      return v;
    }

    // write-through: D1 first, then synchronous invalidation
    async updateHeap(id: string, baseId: string, version: number, lz: Vertex[], fz: number) {
      await this.inner.updateHeap(id, baseId, version, lz, fz);
      await this.kv.delete(`cache:heap:${id}`);
      await this.kv.delete('cache:heap:list');
    }
    async updateTopY(id: string, y: number) {
      await this.inner.updateTopY(id, y);
      await this.kv.delete(`cache:heap:${id}`);
      await this.kv.delete('cache:heap:list');
    }
    // createHeap / updateHeapParams / deleteHeap → invalidate cache:heap:{id} + cache:heap:list
    // createBase → put immutable cache:base:{baseId}; listHeaps → cache cache:heap:list (short TTL)
    // remaining interface methods delegate to inner (+ invalidate where they mutate)
  }
  ```

- [ ] **`server/src/cache/CachedScoreDB.ts`** — same pattern: `getTopScores` caches
  `cache:scores:{heapId}:top:{limit}`; `upsertScore` / `pruneScores` invalidate that heap's
  score keys after the D1 write.

- [ ] **Wire in `server/src/index.ts`** — extend `Env` (four D1 bindings + `CACHE: KVNamespace`),
  add the `ctx` arg to `fetch`, and compose decorators:
  ```ts
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const w = (p: Promise<unknown>) => ctx.waitUntil(p);
    const heapDb  = new CachedHeapDB(new D1HeapDB(env.DB_HEAP), env.CACHE, w);
    const scoreDb = new CachedScoreDB(new D1ScoreDB(env.DB_SCORES), env.CACHE, w);
    const app = createApp(heapDb, scoreDb, {
      codeDb:     new D1RewardCodeDB(env.DB_REWARDS),   // transactional → no cache
      feedbackDb: new D1FeedbackDB(env.DB_TELEMETRY),   // high-write → no cache
      // logSink uses env.DB_TELEMETRY when LOGS (Analytics Engine) is unset
    });
    return app.fetch(request);
  }
  ```

---

## Task 4 — CI + verification

- [ ] **Update `.github/workflows/migrate-d1.yml`** to apply migrations to all four databases
  (loop over `heap_core heap_scores heap_rewards heap_telemetry`) instead of just `heap`.
- [ ] `npm run build` — server + client typecheck green.
- [ ] `cd server && npm test` — existing route/score tests pass unchanged (decorators sit behind
  the same interfaces; mocks are unaffected).
- [ ] **Manual KV check** (`wrangler dev`): first `GET /heaps/:id` → D1 (miss), second → KV (hit);
  a `POST /heaps/:id/place` write invalidates `cache:heap:{id}` so the next read reflects the new
  version. Confirm `logs`/`feedback` never write to KV.

---

## Verification (this plan doc PR)

- The doc lands in `docs/superpowers/plans/` alongside the existing 57 plans and follows the same
  format (Goal / Constraints / File Map / numbered checkbox tasks).
- `npm run build` stays green (this PR adds only markdown).
- Team reviews the embedded config/migrations/decorator code before the follow-up implementation PR.
