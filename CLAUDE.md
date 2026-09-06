# CLAUDE.md — HeapGame

Heap is a mobile-first 2D vertical climbing platformer: players control a trash
item climbing a community-grown heap. Stack: Phaser 3.90, TypeScript 5.9, Vite 6,
Capacitor 8.2. Backend is a Cloudflare Worker (Hono + D1) exposing GUID-based CRUD
at `/heaps`. Tests run via Vitest.

## Layout
- `src/` game client — `scenes/` (Menu, Game, InfiniteGame, Score, …), `systems/`
  (SaveData, clients, physics helpers), `entities/` (Player, Enemy), `ui/`
- The client is split platform/game the same way the worker is:
  `systems/save/core.ts` (identity, write-auth, schema versioning, device prefs)
  + `systems/save/game.ts` (this game's fields, registered via `SaveExtension`),
  re-exported by the `systems/SaveData.ts` barrel; `systems/bootSequence.ts`
  holds the platform half of startup that `BootScene` calls
- `server/` worker — split `platform/` (auth, bans, config, feedback, logging,
  middleware) and `game/` (heaps, scores, codes, daily, customization); each half
  has `routes/` (Hono), `*Db.ts` repos (D1 + Mock + Cached variants) and `cache/`
  KV decorators
- `shared/` types + pure logic used by both sides
- Tests in `__tests__/` dirs across `src/` and `shared/`, and in `server/tests/`
- Specs/plans/runbooks in `docs/superpowers/`

## Commands
- `npm run dev` — Vite on port 3000. **Prefer the user's own dev server: if
  localhost:3000 already responds, use it — never kill it.** If nothing is on :3000,
  you may start one yourself when you need it (e.g. for scene-preview / smoke tests)
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
- New save fields go in `save/game.ts` (all three hooks: `fresh`/`migrate`/`merge`),
  never in `save/core.ts` — core is the half a different game would keep
- `migrate()` and `mergeCloudSave()` spread the game's contribution first and
  core's last, so a game rule can never overwrite a core field. **Don't reorder
  those spreads** — that ordering is what makes the `playerSecret` invariant
  above structural rather than a convention someone has to remember
- Import from the `SaveData` barrel, never `save/core` or `save/game` directly —
  the barrel is what guarantees the extension is registered before `load()` runs
- A gameplay scene that mounts controls must expose `remountControls()`;
  `mountJoystick()` is the only caller of `InputManager.setControlMode`, so
  without it a mid-run control-scheme change silently does nothing

## Project skills (invoke via Skill tool — don't re-derive these workflows)
- `adding-d1-migrations` — any schema change (4 domain DBs, two-file rule, remote apply)
- `releasing-heap` — version bump + what pushing main triggers (Play/itch.io/Pages/D1)
- `smoke-testing-heap` — live browser verification of gameplay/runtime changes
- `load-testing-heap` — k6 load tests vs staging; measure CPU not latency, quotas are account-wide
- `heap-scene-preview` — static scene screenshots at phone sizes (device table inside)
- `triaging-crash-logs` / `triaging-player-feedback` — pull + file production reports

## Tooling (auto-loaded each session — these are just reminders)
- **TheBrain** — run `/hello` at session start, `/wrapup` before closing; recall via brain before grepping files
- **Context7** — fetch live docs for Phaser/Hono/Workers/Capacitor/Vite/Vitest; don't trust training data on APIs
- **Superpowers** — check for a matching skill before non-trivial work (brainstorm before building, TDD before code, verify before "done")
