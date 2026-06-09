# Agents.md — HeapGame

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
Schema changes require a migration file — never edit `server/schema.sql` alone.
1. Add `server/migrations/NNNN_description.sql` with only the incremental SQL
2. Update `server/schema.sql` to the final intended state (for fresh installs)
Apply: `cd server && npx wrangler d1 migrations apply heap-db --local` (or `--remote`).
Never edit an applied migration — write a new one. One migration per change.

## Scene preview devices
`pixel7` 448×970 (default) · `browser` 480×1042 · `iphone14` 390×844 · `desktop` 1280×800

## Tooling (auto-loaded each session — these are just reminders)
- **TheBrain** — run `/hello` at session start, `/wrapup` before closing; recall via brain before grepping files
- **Context7** — fetch live docs for Phaser/Hono/Workers/Capacitor/Vite/Vitest; don't trust training data on APIs
- **Superpowers** — check for a matching skill before non-trivial work (brainstorm before building, TDD before code, verify before "done")
