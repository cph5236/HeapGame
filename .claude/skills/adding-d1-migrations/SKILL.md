---
name: adding-d1-migrations
description: Use when a HeapGame schema change is needed — adding/altering a table, column, or index in any of the four D1 databases — or when checking whether a migration has been applied locally or in production.
---

# Adding D1 Migrations

The backend uses **four domain D1 databases** plus a `CACHE` KV namespace, all
declared in `server/wrangler.toml`:

| Database | Binding | Owns |
|---|---|---|
| `heap_core` | `DB_HEAP` | heap, heap_base, heap_parameters, app config |
| `heap_scores` | `DB_SCORES` | score, player_customization, player_auth |
| `heap_rewards` | `DB_REWARDS` | reward_codes, code_redemptions |
| `heap_telemetry` | `DB_TELEMETRY` | logs, feedback |

`server/migrations/_legacy_heap/` is the frozen pre-sharding history — **never
add migrations there**. Design/runbook: `docs/superpowers/runbooks/d1-sharding-kv-cache.md`.

## Procedure

1. **Pick the database** the table lives in (above). One migration per change.
2. **Write the migration**: `server/migrations/<db>/NNNN_description.sql` with only
   the incremental SQL. `NNNN` continues that DB's own sequence (`ls server/migrations/<db>/`).
3. **Update the fresh-install schema**: edit `server/schema/<db>.sql` to the final
   intended state. (`server/schema.sql` is just an index pointing at these files.)
4. **Apply locally**:
   ```bash
   cd server && npx wrangler d1 migrations apply <db> --local
   ```
5. **Remote apply** happens automatically when the PR merges to main —
   `.github/workflows/migrate-d1.yml` runs on pushes touching `server/migrations/**`
   (also `workflow_dispatch`). Manual fallback: same command with `--remote`.

Check applied state: `cd server && npx wrangler d1 migrations list <db> --local` (or `--remote`).

## Ripple effects to check

- **Repo triples**: repository methods exist in three flavors — real D1 repo,
  the Mock used by `server/tests/`, and the Cached decorator in `server/src/cache/`.
  A new column/method must be implemented in all three or tests/prod diverge.
- **Cache staleness**: if the change alters data shape served by a cached read,
  bump/invalidate the relevant KV cache key logic in `server/src/cache/`.
- **Shared types**: update `shared/*.ts` types alongside the schema.

## Rules

- **Never edit an applied migration** — write a new one. Production may be ahead
  of your assumptions; check with `migrations list --remote` before renumbering.
- Schema file changes without a migration file (or vice versa) are incomplete.
- Never commit `.wrangler/state/` (local D1 state).
- A PR with a migration isn't "live" at merge time everywhere instantly — if the
  worker code *requires* the new schema, note in the PR that migrate-d1.yml must
  succeed before the worker serves traffic (see the player-auth 0003 lockout lesson).
