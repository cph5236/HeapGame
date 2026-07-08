# CLAUDE.md — HeapGame

Heap is a mobile-first 2D vertical climbing platformer: players control a trash
item climbing a community-grown heap. Stack: Phaser 3.90, TypeScript 5.9, Vite 6,
Capacitor 8.2. Backend is a Cloudflare Worker (Hono + D1) exposing GUID-based CRUD
at `/heaps`. Tests run via Vitest.

## Layout
- `src/` game client — `scenes/` (Menu, Game, InfiniteGame, Score, …), `systems/`
  (SaveData, clients, physics helpers), `entities/` (Player, Enemy), `ui/`
- `server/` worker — `routes/` (Hono), `*Db.ts` repos (each has D1 + Mock + Cached
  variants), `cache/` KV decorators
- `shared/` types + pure logic used by both sides
- Tests in `__tests__/` dirs across `src/` and `shared/`, and in `server/tests/`
- Specs/plans/runbooks in `docs/superpowers/`

## Commands
- `npm run dev` — Vite on port 3000. **The user runs their own dev server — never
  start or kill one**; just use localhost:3000 if it responds
- `npm test` — Vitest
- `npm run build` — **always run before claiming work is done**; catches TS errors tests miss
- `npm run seed` — seed local D1
- `npm run scene-preview -- <Scene> '<json>' <device>` — scene screenshot (see skill)
- `npm run bump [patch|minor|major]` — version bump, package.json + Android gradle (see skill)

## Conventions
- Branch off `main` for all work (incl. tooling/CI); PR before merge, never push
  direct to main (sole exception: the user's own `V0.x.y` release commits)
- **No git worktrees** — regular feature branches in the main working dir
- Don't commit `.wrangler/state/` (local D1 state)
- Per-player server calls key on `getEffectivePlayerId()` from `SaveData` (GPGS id
  if signed in, else GUID) — never bare `getPlayerGuid()`
- Player writes are auth-gated (TOFU `playerSecret` + `X-Player-Token`); any code
  path that migrates/merges SaveData **must carry `playerSecret`** or players get
  403-locked out of their own data

## Project skills (invoke via Skill tool — don't re-derive these workflows)
- `adding-d1-migrations` — any schema change (4 domain DBs, two-file rule, remote apply)
- `releasing-heap` — version bump + what pushing main triggers (Play/itch.io/Pages/D1)
- `smoke-testing-heap` — live browser verification of gameplay/runtime changes
- `heap-scene-preview` — static scene screenshots at phone sizes (device table inside)
- `triaging-crash-logs` / `triaging-player-feedback` — pull + file production reports

## Tooling (auto-loaded each session — these are just reminders)
- **TheBrain** — run `/hello` at session start, `/wrapup` before closing; recall via brain before grepping files
- **Context7** — fetch live docs for Phaser/Hono/Workers/Capacitor/Vite/Vitest; don't trust training data on APIs
- **Superpowers** — check for a matching skill before non-trivial work (brainstorm before building, TDD before code, verify before "done")
