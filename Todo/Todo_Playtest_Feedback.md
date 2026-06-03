# Playtester Feedback — Exploration (2026-06-01)

Grounded exploration of the 8 playtest items. Each entry: what it means, where it
touches the codebase, an implementation sketch, an effort estimate, and open
questions. Source list lives in [Todo.md](./Todo.md). Action each item on its own
feature branch (one PR per item — see CLAUDE.md branch discipline).

**Effort key:** S = a sitting · M = a focused session · L = multi-session / external deps

**Suggested sequencing** (cheap wins + bug first, big/blocked last):
3 (bug) → 2 (wiring) → 7 → 8 → 5 → 1 → 4 → 6

---

## 3. Item pickup button makes the player jump — **BUG**

**What:** On mobile, tapping the on-screen **GRAB** button to collect a salvage
pickup also makes the player jump.

**Root cause (confirmed):** The GRAB button is a Phaser interactive rectangle
([PickupManager.createGrabButton](../src/systems/PickupManager.ts#L330)), but
[InputManager](../src/systems/InputManager.ts#L63-L66) attaches its own
`touchstart`/`touchend`/`touchmove` listeners directly on `window`. A short tap on
the button satisfies the "not a swipe, not a drag" branch in
[onTouchEnd](../src/systems/InputManager.ts#L230-L232) and sets `pendingJump = true`.
Phaser's pointer system and the raw window listeners are independent, so the same
tap drives both the GRAB handler and a jump. The same class of bug affects any
on-screen button during gameplay (the PLACE button is continuous-hold so it's less
obvious, but worth checking).

**Sketch:**
- Give `InputManager` a way to suppress a tap that lands on a UI control. Options:
  - A `consumeNextTap()` / `suppressTapAt(x,y)` call the button invokes on
    `pointerdown`, checked in `onTouchEnd`; **or**
  - Register screen-space "dead zones" (rects) with InputManager; taps inside a
    dead zone don't generate jump/dash/dive. The GRAB and PLACE buttons register
    their bounds. This generalises to future buttons (e.g. a joystick — item 1).
- Lean toward the dead-zone registry; it also solves the joystick collision later.

**Effort:** S

**Open questions:**
- Does the PLACE button have the same bleed-through? (Verify on device.)
- Should dead zones live in `InputManager` or a small shared `TouchUI` registry?

---

## 2. Leaderboards visible from the main menu

**What:** Add a way to view leaderboards directly from the main menu (currently
only seen after a run, inside ScoreScene).

**Current state:** [LeaderboardScene.ts](../src/scenes/LeaderboardScene.ts) exists
and its key is registered, but **nothing starts it** — `scene.start('LeaderboardScene')`
appears nowhere. ScoreScene renders its own inline leaderboard panel
([ScoreScene.createLeaderboardPanel](../src/scenes/ScoreScene.ts#L191)) via the
`/scores/:heapId` + `/scores/:heapId/context` endpoints
([scores.ts](../server/src/routes/scores.ts#L280-L292)). So the data path exists;
the standalone scene is orphaned.

**Sketch:**
- Add a **LEADERBOARD** button to [MenuScene](../src/scenes/MenuScene.ts) next to
  UPGRADES/STORE (the menu already lays buttons out in a 320px-wide group — needs a
  layout pass to fit a 3rd/4th button or a row reflow). Wire `pointerup` +
  a hotkey (`L`) to `scene.start('LeaderboardScene')`.
- Confirm `LeaderboardScene` renders correctly when entered cold from the menu
  (it may assume run-context data the way ScoreScene passes `mockLeaderboard`).
  If it needs a heap to show, default to the active heap from the registry and
  let the player switch heaps within the board.
- Back button returns to MenuScene.

**Effort:** S–M (mostly wiring + menu layout + verifying the orphaned scene)

**Open questions:**
- Per-heap board only, or an aggregate "all heaps" view too?
- Keep ScoreScene's inline panel as-is, or have it deep-link into LeaderboardScene?

---

## 7. Rats patrol too far / can move inside the heap

**What:** Rats wander across spans wide enough to walk into concave sections of the
heap, ending up visually buried and hard to see.

**Where:** Patrol bounds are set once per spawn in
[EnemyManager.onBandLoaded](../src/systems/EnemyManager.ts#L114-L147): `minX/maxX`
are the raw extents (`leftV.x`→`rightV.x`) of the single polygon edge the rat
spawned on. The percher branch in
[update](../src/systems/EnemyManager.ts#L217-L277) interpolates the rat's Y along
that edge and flips direction at `minX`/`maxX`. A long edge — or one that dips
inward — gives a wide patrol that can track into the heap interior.

**Sketch:**
- Clamp the patrol span to a max width centred on the spawn point, e.g.
  `minX = max(leftV.x, spawnX - HALF)`, `maxX = min(rightV.x, spawnX + HALF)` with
  a tunable `RAT_MAX_PATROL_PX`.
- Optionally reject spawn edges whose slope is steep enough that the interpolated Y
  sinks below neighbouring exterior surface (keep rats on near-flat, visible tops).
- Add/extend tests in
  [EnemyManager.test.ts](../src/systems/__tests__/EnemyManager.test.ts) for the
  clamped-bounds case.

**Effort:** S–M

**Open questions:**
- One global max patrol width, or scale it by heap difficulty/spawn density?
- Is "inside the heap" purely a wide-edge issue, or do some edges genuinely face
  inward and shouldn't spawn rats at all? (Spawn filter already rejects interior
  edges — verify it's catching these.)

---

## 8. Add more things to the store

**What:** Expand the store's catalog beyond the current 4 items.

**Where:** Catalog is [ITEM_DEFS](../src/data/itemDefs.ts) — today: Ladder, I-Beam,
Checkpoint (placeable) + Shield (buff). [StoreScene](../src/scenes/StoreScene.ts)
renders ITEM_DEFS with All/Placeable/Buff tabs and accent colors per id
([ACCENT_COLORS](../src/scenes/StoreScene.ts#L20-L25)); purchase flows through
[SaveData.purchaseItem](../src/systems/SaveData.ts). Adding a *data-only* item is
cheap; adding new behavior (a new placeable type or a new buff effect) needs
gameplay wiring in PlaceableManager / Player.

**Sketch:**
- For each new item: ITEM_DEFS entry (id, name, desc, cost, category,
  persistsOnHeap) + an ACCENT_COLORS entry. If placeable → register sprite +
  placement behavior in PlaceableManager; if buff → wire the effect (model on the
  existing Shield buff).
- This is a content/design task — needs a list of *what* to add before estimating
  precisely. Candidate ideas: more buffs (extra air-jump charge, head-start coins,
  one-time revive), cosmetic trash-bag skins, consumable boosts.

**Effort:** S per data-only item · M+ per item that needs new mechanics

**Open questions:**
- What items does the designer actually want? (Blocked on a list.)
- Cosmetic-only items (skins) — worth a new category tab?

---

## 5. Specific item rarity — rarity tiers for items

**What:** Add rarity tiers to the salvage pickups so some are rarer / more
exciting to find.

**Where:** [pickupDefs.ts](../src/data/pickupDefs.ts) — 20 salvage items. Spawn
selection today is driven by `polarity` (positive/negative) and a per-heap
positive/negative spawn-rate mix (migration
[0007](../server/migrations/0007_add_item_spawn_rates.sql)); the spawn roll lives in
[PickupManager](../src/systems/PickupManager.ts#L124). Score values are pinned in
`shared/pickupScores`. There is no rarity concept yet.

**Sketch:**
- Add a `rarity: 'common' | 'uncommon' | 'rare' | 'legendary'` field to `PickupDef`
  with a weight per tier.
- Fold rarity weight into the spawn-selection roll (compose with the existing
  positive/negative mix rather than replacing it).
- Visual treatment: drive the existing glow color/intensity
  ([GLOW_TEX_KEY](../src/systems/PickupManager.ts#L47)) by rarity so rarer items
  read as special; maybe a rarity label in the proximity overlay.
- Keep score authority on the server — if rarity affects `scoreBonus`, update
  `shared/pickupScores` so client + server agree.

**Effort:** M

**Open questions:**
- Does rarity affect score bonus, or only spawn frequency / visual flair?
- How does rarity interact with the per-heap positive/negative mix — orthogonal
  axis, or do rarer items skew toward one polarity?

---

## 1. Movement joystick (optional, toggleable)

**What:** An on-screen virtual joystick as an alternative to phone tilt for
left/right movement, switchable in settings.

**Where:** Movement currently comes *only* from device tilt:
[InputManager](../src/systems/InputManager.ts#L92-L107) computes `tiltFactor` /
`goLeft` / `goRight` from `deviceorientation`. The player consumes those each frame.
Settings live in the MenuScene gear panel
([createSettingsButton](../src/scenes/MenuScene.ts#L621), Sounds/Dev tabs) — there
is no Controls section and no persisted control-mode flag in SaveData.

**Sketch:**
- Add a `controlMode: 'tilt' | 'joystick'` setting persisted in SaveData, with a
  new **Controls** section/tab in the settings panel.
- Build a `VirtualJoystick` UI (screen-space, scroll-factor 0) shown in GameScene
  when `controlMode === 'joystick'`. It writes the *same* `tiltFactor` / `goLeft` /
  `goRight` that tilt produces, so the player code is unchanged.
- Register the joystick's screen rect as an InputManager dead zone (depends on the
  tap-suppression work from item 3) so dragging it doesn't fire jump/dash.
- Hide the "Enable Tilt Controls" prompt when joystick mode is active.

**Effort:** M (cleanest if item 3's dead-zone registry lands first)

**Open questions:**
- Fixed-position joystick, or floating (appears where the thumb touches)?
- Left side, right side, or configurable? (GRAB/PLACE buttons occupy bottom-centre.)
- Does the joystick also handle jump/dash/dive, or only horizontal movement
  (swipes/taps unchanged)?

---

## 4. Reward codes system

**What:** Redeemable codes that grant rewards (e.g. coins) — handed out for things
like social-media posts.

**Where:** New backend surface. The server is Hono + D1 with `/heaps`, `/scores`,
`/log` routes ([app.ts](../server/src/app.ts)); admin-only mutations sit behind
`adminGate` and writes are rate-limited. Coins are a *client* concept today —
[SaveData.addBalance/getBalance](../src/systems/SaveData.ts) — so a code redemption
needs to grant coins client-side after server validation, and guard against replay.

**Sketch:**
- **Schema:** new migration `0008_reward_codes.sql` — a `reward_codes` table
  (code, reward_type, reward_amount, max_redemptions, redeemed_count, expires_at)
  and a `code_redemptions` table (code + playerGuid, unique) to enforce one
  redemption per player. Update `server/schema.sql` to match (per D1 migration
  rules in CLAUDE.md).
- **Endpoints:** `POST /codes/redeem` (rate-limited, validates code + per-player
  uniqueness, returns the reward); `POST /codes` behind `adminGate` to mint codes.
- **Client:** a "Redeem code" entry field (settings panel or menu), call redeem,
  apply reward to SaveData on success, show result. Since coins are server-trusted
  for scores but client-held for balance, decide how redeemed coins reconcile with
  the GPGS cloud-save balance.
- **Abuse:** rate limit + per-player uniqueness + optional expiry/max-redemptions.

**Effort:** L

**Open questions:**
- Reward types: coins only to start, or also items / cosmetics?
- Single-use-per-player shared codes (social posts) vs unique one-time codes?
- Who mints codes — admin endpoint + a CLI, or generated in bulk?

---

## 6. iOS build

**What:** Ship an iOS build of the game.

**Current state:** Capacitor is configured
([capacitor.config.ts](../capacitor.config.ts)) and the web build is solid, but there
is **no `ios/` directory** — only `android/`. Build scripts only cover Android
(`build:android` → `cap sync`).

**Sketch / dependencies:**
- `cap add ios`, then an Xcode project — **requires macOS + Xcode** (no Mac in the
  current toolchain) and an **Apple Developer account** ($99/yr).
- Plugin parity: `@capacitor-community/admob` supports iOS (the AdProvider pattern
  already abstracts this — see Todo_Inprogress "Ad Integration"). **Google Play
  Games Services has no iOS equivalent** — sign-in / achievements / leaderboards /
  cloud-saves would need Apple Game Center or a custom path, or be disabled on iOS.
- CI: a macOS runner for archiving + TestFlight upload.
- Safe-area / notch handling: [safeArea.ts](../src/utils/safeArea.ts) already exists
  — verify it covers iOS insets.

**Effort:** L (gated on external resources: a Mac, Apple Developer account)

**Open questions:**
- Is a Mac / Apple Developer account available? (Hard blocker.)
- iOS identity story: Game Center, anonymous-only, or skip GPGS-style features?
- Target App Store, or TestFlight beta first (mirrors the Android closed-beta plan)?

---

### Cross-cutting note
Items **3 → 1** share infrastructure: the tap-suppression / dead-zone registry built
for the GRAB-button bug is exactly what the joystick needs to avoid firing jumps.
Build it once in item 3, reuse it in item 1.
