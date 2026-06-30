# CLAUDE.md — HeapGame

Heap is a mobile-first 2D vertical climbing platformer: players control a trash
item climbing a community-grown heap. Stack: Phaser 3.90, TypeScript 5.9, Vite 6,
Capacitor 8.2. Backend is a Cloudflare Worker (Hono + D1) exposing GUID-based CRUD
at `/heaps`. Tests run via Vitest.

## Layout
- `src/` game client · `server/` worker · `shared/` shared types
- Tests live in `__tests__/` dirs across `src/` and `shared/`, and in `server/tests/`
- Plans live in `docs/superpowers/plans/`

## Commands
- `npm run dev` — Vite on port 3000
- `npm test` — Vitest
- `npm run build` — **always run before claiming work is done**; catches TS errors tests miss
- `npm run seed` — seed local D1
- `npm run scene-preview -- <Scene> '<json>' <device>` — screenshot a scene at phone size

## Conventions
- Branch off `main` for all work (incl. tooling/CI); PR before merge, never push direct to main
- **No git worktrees** — use regular feature branches in the main working dir
- Don't commit `.wrangler/state/` (local D1 state)

## D1 migrations
The backend is split into four domain D1 databases (see the sharding plan/runbook
in `docs/superpowers/`): `heap_core` (binding `DB_HEAP`), `heap_scores` (`DB_SCORES`),
`heap_rewards` (`DB_REWARDS`), `heap_telemetry` (`DB_TELEMETRY`) — all declared in
`server/wrangler.toml`, plus a `CACHE` KV namespace. Read-heavy repos are wrapped by
the cache decorators in `server/src/cache/`. Pick the DB a table lives in before
adding a migration.

Schema changes require a migration file — never edit the per-DB schema alone.
1. Add `server/migrations/<db>/NNNN_description.sql` with only the incremental SQL
   (`<db>` is the database, e.g. `heap_core`)
2. Update `server/schema/<db>.sql` to the final intended state (for fresh installs).
   `server/schema.sql` is now just an index pointing at those per-DB files.
Apply: `cd server && npx wrangler d1 migrations apply <db> --local` (or `--remote`).
Remote applies are also driven by `.github/workflows/migrate-d1.yml` (loops all four).
Never edit an applied migration — write a new one. One migration per change.

## Scene preview devices
`pixel7` 448×970 (default) · `browser` 480×1042 · `iphone14` 390×844 · `desktop` 1280×800

## Tooling (auto-loaded each session — these are just reminders)
- **TheBrain** — run `/hello` at session start, `/wrapup` before closing; recall via brain before grepping files
- **Context7** — fetch live docs for Phaser/Hono/Workers/Capacitor/Vite/Vitest; don't trust training data on APIs
- **Superpowers** — check for a matching skill before non-trivial work (brainstorm before building, TDD before code, verify before "done")
