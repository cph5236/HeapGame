# Game Template Repo Extraction — Plan

**Goal:** Produce a reusable **template repository** carrying HeapGame's platform
(boot flow, save core, settings menu, input, audio, logging, feedback, remote
config, player auth, ads, GPGS, update gate, Worker+D1 backend, CI, Capacitor
shipping) with a blank playable scene in place of Heap's gameplay.

**Non-goal:** an npm package. This is a copy-and-diverge template. The seam
defined below is what makes divergence survivable, not a published version.

**Strategy:** Two phases. **Phase A** cuts the platform/game seam *in place on
HeapGame*, one behavior-neutral PR at a time, each shipping to production on
merge. **Phase B** forks at the Phase-A-complete commit and deletes the game.

Cutting the seam in HeapGame first is the whole trick: it proves each boundary
against a real game before the template depends on it, and it leaves HeapGame
better rather than leaving behind a copy that rots.

---

## The seam

Every file lands on one side. This is the single decision the rest of the plan
executes against.

| Layer | Platform (template owns) | Game (deleted in the template) |
|---|---|---|
| Scenes | Boot, Loading, Menu (shell), Pause, UpdateRequired, FeedbackOverlay | Game, InfiniteGame, Score, HeapSelect, Upgrade, Store, Customization, Tutorial, Leaderboard, TexturePreview |
| Systems | InputManager, joystick/tilt stack, AudioManager, displayMetrics, SaveData **core**, UpdateGate, ConfigClient, FeedbackClient, PlayGamesClient, gpgsSession, cloudSave, authToken, ads/, logging/ | Heap*, Placeable, Enemy, Pickup, Portal, TrashWall, Bridge, LayerGenerator, Buff, RunSession, ScoreClient, DailyDrop, Customization, cosmetics* |
| Entities | — | all 14 |
| Data | soundDefs (stubbed), attributions | the other 20 |
| Shared | logging, versionGate, playerName, configTypes, feedbackTypes | heapPolygon/, heapTypes, scoreTypes, cosmeticCatalog, dailyDrop, enemyDefs, pickupScores, buildRunScore, itemIds |
| Server | auth, bans, config, feedback, log, players, middleware/, cache decorator pattern, D1+Mock+Cached triple | heap, scores, codes, daily, customization, contribution |
| Infra | all 11 workflows, vite/tsconfig/vitest, scripts (bump, preview-scene, dpr-gate), Capacitor + android shell | seed-heap, gen-heap-*, loadtest/, slice_sprites |

Roughly **9,000 of 33,000 non-test lines survive**, of which ~2,500 need real
rewriting rather than moving. ~40 of 160 test files survive.

---

## Rules that keep main shippable

1. **A PR is either a move or a rewrite — never both.** A move PR is reviewed by
   reading the file list; a rewrite PR is reviewed by reading the diff. Combined,
   neither is possible.
2. **Every Phase A PR is behavior-neutral** and merges to `main`, which ships to
   Pages/Play/itch. If a PR can't be verified as neutral, it's too big.
3. **Absorb call-site churn with barrel re-exports.** When a file splits, the old
   path stays as a re-export so the diff outside the split is zero. Delete the
   barrel in a later, separate PR (or never).
4. **Frozen in Phase A:** `SAVE_KEY`, `CURRENT_SCHEMA`, every HTTP route path,
   every D1 schema. A save-format or route change hiding inside a refactor is the
   one way this breaks live players.
5. **Gate each merge on** `npm run build` + `npm test` + the `smoke-testing-heap`
   skill, plus `heap-scene-preview` before/after shots for any PR touching UI.

---

## Phase A — in-place seam cutting (HeapGame `main`)

### PR A1 — Extract the settings panel out of MenuScene
**Why first:** it's the thing the template exists to keep, it's the most tangled,
and it's independently valuable to HeapGame (PauseScene already duplicates two of
its widgets).

- Create `src/ui/settingsPanel.ts` — `buildSettingsPanel(scene, opts)` returning
  a handle with `open()` / `close()` / `refresh()`.
- Move `MenuScene.createSettingsButton()` (~lines 932–1220, ~290 lines) into it.
- **Tabs become injected, not hardcoded.** Sounds and Controls tabs are platform
  and live in the module. The Player tab's rows arrive as a `rows: SettingsRow[]`
  option so Redeem Code, How to Play, and reset-warning copy stay in MenuScene.
  Privacy options and analytics-consent stay platform (both are policy, not game).
- Builder function, not a `SettingsScene`: PauseScene already consumes
  `buildVolumePanel` / `buildControlsOverlay` this way, and an overlay scene would
  need its own camera and depth handling for no gain.
- Keep `forceSettingsOpen` init-data behavior intact.

Size ~290 moved / ~150 new. Risk: medium — heavy depth + visibility bookkeeping,
and the tilt-prompt refresh path (`refreshTiltPrompt`) crosses the boundary.
Verify: scene-preview of Menu, each of the 3 tabs, at 2 device sizes; smoke test
that changing control mode from Settings still remounts controls.

### PR A2 — Split SaveData into core + game
**Riskiest PR in the plan.** It touches the live save file.

- `src/systems/save/core.ts` — `schemaVersion`, load/save/cache, `playerGuid`,
  `playerSecret`, `playerName`, `gpgsPlayerId`, `getEffectivePlayerId`,
  `soundSettings`, `controlMode` + session override, `joystickSide`,
  `verboseLogging`, `remoteConfig` cache, `resetAllData`, the migration **runner**.
- `src/systems/save/game.ts` — `balance`, `upgrades`, `inventory`, `placed`,
  `selectedHeapId`, `highScores`, `beatenHeapIds`, cosmetics, `hatAdjustments`,
  `tutorialDone`, `customizeHintSeen`, ad run state, the v1→v5 migration steps.
- `src/systems/SaveData.ts` becomes a pure re-export barrel — **zero call-site
  changes** anywhere else in the repo.
- Core owns `mergeCloudSave`'s structure and takes a game-supplied field-merge
  hook. The `playerSecret` carry-through must be **structural in core**, not a
  documented rule: any merge path that drops it 403-locks a player out of their
  own data. Add a core test that asserts the secret survives every merge branch.
- Core's `RawSave` is `CoreSave & GameSave`; `game.ts` declares its half.

Size ~450 lines redistributed, ~120 new (the extension plumbing). Risk: **high**.
Verify: the existing `SaveData.test.ts` must pass **unmodified** — if it needs
edits, the split changed behavior. Add core-boundary tests. Manually load a real
pre-split `heap_save` blob and assert byte-identical round-trip.

### PR A3 — Extract the boot sequence
- Create `src/systems/bootSequence.ts` owning the ordered startup: prime config →
  GPGS sign-in → ad consent → cloud-save merge → update gate → asset preload,
  with game-specific steps (heap catalog fetch, infinite preload) passed in as
  injected stages.
- `BootScene` and `LoadingScene` consume the sequence's readiness gates instead of
  importing `HeapClient` / `infinitePreload` directly.
- Preserve the ordering constraints already documented in `main.ts` and
  `LoadingScene` — including `MENU_LOADING_MIN_MS` and the consent timeout.

Size ~200 moved, ~100 new. Risk: medium — boot-order regressions surface as
first-launch-only bugs. Verify: smoke test cold start with cleared localStorage,
offline start, and forced-update start.

### PR A4 — Server: platform/ and game/ route split
- `server/src/platform/` ← auth, bans, config, feedback, log, players, middleware,
  `cache/` decorators, `playerAuth`, and the D1/Mock/Cached base pattern.
- `server/src/game/` ← heap, scores, codes, daily, customization, contribution,
  `db.ts` (which is entirely `HeapDB`), `scoreDb`, `runSession`.
- `createApp` splits: `createPlatformApp(opts)` returns a Hono the game mounts
  onto. `AppOptions` splits the same way.
- Tests move with their subjects.

Pure file moves plus one wiring change. Risk: low — but **no route path may
change**; add a route-inventory test that snapshots the mounted path list.

### PR A5 — Parameterize app identity
- One `app.config.ts` holding app name, bundle id, primary domain, store URLs,
  support email, and the SEO/JSON-LD block.
- `index.html` (21KB, currently hardcoded to heapgame.com + the itch.io embed
  path) reads from it via a small Vite HTML transform.
- `capacitor.config.ts`, `android/app/build.gradle` `applicationId`/`namespace`,
  and `android/app/src/main/res/values/strings.xml` read the same source.

Risk: medium — an SEO/meta regression on the live site is invisible in tests.
Verify: diff built `dist/index.html` against today's; only intended lines change.

### PR A6 — Split `constants.ts` and tidy `shared/`
Small cleanup PR: physics/gameplay constants to a game module, display/timing
constants to platform; same for the handful of `shared/` files that mix both.
Do this last — earlier PRs will have revealed which constants actually cross.

---

## Phase B — the template repo

Fork at the Phase-A-complete commit. Each of these is a PR in the new repo.

### PR T1 — Delete the game
Pure deletion, nothing renamed or rewritten, so review is one question per file:
*is this game-specific?* Removes 10 scenes, all `entities/`, 20 of 22 `data/`,
~50 of 75 `systems/`, the `game/` server half, `loadtest/`, ~23MB of art/audio,
~120 test files. **The build will be red at the end of this PR** — that's fine and
expected; T2 restores it. Note it in the PR body.

### PR T2 — Blank scene + reduced menu
- `MenuScene` down to ~350 lines: title, Play, Settings, Feedback, name entry.
- New `GameScene` — blank scene, pause button, camera, a placeholder sprite, and a
  commented "your game starts here" seam. Wired to PauseScene.
- `main.ts` scene list trimmed. Build green again.

### PR T3 — Stub the content layer
`soundDefs` to 3 stub sounds, `loadGameAssets` to a 3-entry manifest, a single
placeholder sprite, `save/game.ts` reduced to a documented empty extension with
one example field so the pattern is visible.

### PR T4 — Fresh infrastructure
- Collapse the 4 D1 shards to 2 (`app_core`, `app_telemetry`) — the sharding
  pattern is documented in `runbooks/d1-sharding-kv-cache.md` and stays available,
  but a template shouldn't start with four databases.
- `wrangler.toml` with placeholder ids and a `SETUP.md` runbook listing every
  resource to provision and every GitHub secret to set.
- Migrations reset to a single `0001_init` per database.

### PR T5 — Rename and document
`heap`→`app` identifiers, new `CLAUDE.md`, `README.md` with a "new game in an
afternoon" checklist, `.claude/skills/` pruned to `pr-feedback` + a generalized
release skill + a new `bootstrapping-a-new-game`.

### PR T6 — Prove it
CI green, `npm run build` clean, deploy to a throwaway Pages project, build a
debug APK, scene-preview shots of Menu and all Settings tabs. Tag `v1.0.0`.

---

## Infrastructure checklist (Phase B, non-code)

Per new game instantiated from the template: 2 D1 databases, 1 KV namespace,
1 Analytics Engine dataset, Cloudflare API token, Pages project, domain, Play
Console app + upload keystore + service-account JSON, GPGS app id, AdMob app +
unit ids, itch.io project + butler key. Roughly 12 GitHub secrets. Budget 1–2
days of clicking and waiting, mostly Play Console review latency.

---

## Keeping the two repos in step

After Phase A, HeapGame and the template share the seam, so platform fixes
cherry-pick cleanly. Add `PLATFORM.md` to both listing the template-owned paths,
so a PR touching one is visibly a candidate for porting. Don't automate this —
a list two people read beats a sync script nobody trusts.

---

## Open decisions

1. **Template repo name / npm-scope-free package name.**
2. **Settings panel: builder vs scene** — plan assumes builder (A1). Cheap to
   revisit before A1 lands, expensive after.
3. **Does the template keep ads and GPGS wired, or stubbed behind a flag?**
   Wired-with-null-provider is the recommendation: `NullProvider` already exists
   and a stubbed integration is the kind of thing nobody finishes later.
4. **Whether A6 is worth doing at all**, or whether the constants seam is better
   left for T2 to sort out in the template.
