# Reward Codes System — Design Spec

**Date:** 2026-06-06
**Feature:** Playtest feedback item #4 — redeemable codes that grant rewards
(coins or items), handed out for things like social-media posts.
**Branch:** `feature/reward-codes` (off latest `main`, incl. merged joystick PR #42)

## Goal

Let players enter a short code (e.g. from a tweet) and receive a reward. Codes
are minted by an admin, validated server-side, and the reward is applied to the
player's **client-held** balance/inventory after the server confirms the
redemption is legitimate and not a replay.

A single code mechanism covers both **shared** codes (one redemption per player,
many players) and **unique one-time** codes — controlled by a `max_redemptions`
column.

## Decisions (resolved during brainstorming)

| Question | Decision |
|---|---|
| Reward types | **Coins + items.** `reward_type ∈ {'coins','item'}`; `reward_id` holds the item id for `'item'`, `reward_amount` is the coin count or item quantity. (No upgrades/cosmetics for now.) |
| Code model | **Both, via `max_redemptions`** — `1` = unique one-time, `N` = capped shared, `0` = unlimited shared. One mechanism. |
| Replay guard | **Per-player once, hard error on retry.** `(code, player_guid)` unique row. A second redeem by the same player returns "already redeemed". Accepted tiny risk: client crash after the server records but before applying loses that reward. |
| Expiry | **Optional `expires_at`** (nullable ISO8601). Expired codes rejected. |
| Code string | **Admin picks it** (e.g. `LAUNCH2026`). Server normalizes to UPPERCASE and rejects duplicates. |
| Minting | **Admin endpoint** `POST /codes` (behind `adminGate`, curl-able) **and** a Reward Codes section in `admin/index.html`. |
| Redeem UI | In the **MenuScene settings panel**, in the **"Dev" tab renamed to "Player"** (reorganized — see §6). |
| Cloud reconciliation | **None needed.** Coins → `balance`, items → `inventory`; both already merge by `Math.max` in `mergeCloudSave`. Per-GUID server guard + stable `playerGuid` across merges ⇒ no cross-device double-redeem. |

## Known limitation (by design)

Coins and items are **client-held** (`SaveData.balance` / `inventory`), not
server-authoritative. A determined cheater editing `localStorage` can already
grant themselves rewards — that's true of all existing coins. The server gate
here only prevents *casual* double-redeems and enforces global caps/expiry. This
is accepted and documented; we do not try to make balances server-authoritative.

## Architecture

### 1. Data model — migration `0008_reward_codes.sql`

New migration file with only the incremental SQL, plus a matching update to
`server/schema.sql` (per the D1 migration rules in CLAUDE.md — never edit an
applied migration, never edit `schema.sql` alone).

```sql
CREATE TABLE IF NOT EXISTS reward_codes (
  code            TEXT PRIMARY KEY,          -- normalized UPPERCASE
  reward_type     TEXT NOT NULL,             -- 'coins' | 'item'
  reward_id       TEXT,                       -- item id when type='item', NULL for coins
  reward_amount   INTEGER NOT NULL,           -- coin count, or item quantity
  max_redemptions INTEGER NOT NULL DEFAULT 0, -- 0 = unlimited; 1 = one-time; N = capped
  redeemed_count  INTEGER NOT NULL DEFAULT 0,
  expires_at      TEXT,                        -- nullable ISO8601; NULL = never
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS code_redemptions (
  code        TEXT NOT NULL,
  player_guid TEXT NOT NULL,
  redeemed_at TEXT NOT NULL,
  PRIMARY KEY (code, player_guid)   -- enforces one redemption per player
);
```

### 2. Shared types — `shared/codeTypes.ts`

Single-sourced contract used by server, client, and tests:

- `RewardType = 'coins' | 'item'`
- `RewardPayload = { rewardType: RewardType; rewardId?: string; rewardAmount: number }`
- `RedeemCodeRequest = { code: string; playerGuid: string }`
- `RedeemCodeResponse = RewardPayload` (on 200)
- `CreateCodeRequest = { code: string; rewardType: RewardType; rewardId?: string; rewardAmount: number; maxRedemptions?: number; expiresAt?: string | null }`
- `CodeListEntry` for the admin `GET /codes` listing (code, type, id, amount,
  max, redeemed_count, expires_at, created_at).

### 3. Server — D1 access `server/src/codeDb.ts`

`RewardCodeDB` wrapping the D1 binding, mirroring the existing `ScoreDB`/`HeapDB`
style:

- `createCode(req, now)` — insert; throws/returns a typed conflict on duplicate code.
- `getCode(code)` — fetch one (or null).
- `listCodes()` — all codes for the admin listing.
- `redeem(code, guid, now)` — the critical path. Uses a D1 `batch()` so the
  uniqueness check + redemption insert + `redeemed_count` increment are atomic.
  Returns a discriminated result: `ok` (with `RewardPayload`), `notFound`,
  `expired`, `exhausted`, `alreadyRedeemed`. The `(code, player_guid)` PK is the
  backstop against races — an insert that violates it ⇒ `alreadyRedeemed`.

### 4. Server — routes `server/src/routes/codes.ts`

A Hono sub-app, mounted at `/codes`:

- `POST /codes/redeem` — body `RedeemCodeRequest`. Normalizes code → UPPERCASE,
  validates shape, calls `redeem()`. Maps result → HTTP:
  `200` ok (returns `RewardPayload`), `404` notFound, `410` expired,
  `409` exhausted **or** alreadyRedeemed (distinguished by an `error` string in
  the body so the client can show the right message). **Rate-limited.**
- `POST /codes` — `adminGate`. Body `CreateCodeRequest`. Normalizes, validates
  (`rewardType` enum; `reward_id` required when `'item'`; `rewardAmount > 0`;
  `maxRedemptions >= 0`; valid `expiresAt` if present), rejects duplicates → `409`.
- `GET /codes` — `adminGate`. Returns `CodeListEntry[]` for the admin UI.

Item-id validity is **not** enforced server-side (server doesn't own `ITEM_DEFS`);
the admin UI offers a dropdown of known item ids to prevent typos, and the client
validates against `ITEM_DEFS` on redeem (unknown id ⇒ error result, not a silent
dead reward).

### 5. Server — wiring `server/src/app.ts`

- `createApp(heapDb, scoreDb, codeDb, opts)` — add the `codeDb` param. Update all
  call sites that construct the app (worker entry + test harness/helpers).
- Add a `codes?: RateLimiter` bucket to `AppOptions.limiters`; apply it:
  `app.post('/codes/redeem', rateLimit(lim.codes, 'codes-redeem'))`.
- `adminGate` on the admin routes: `app.post('/codes', adminGate)` and
  `app.get('/codes', adminGate)`.
- `app.route('/codes', codeRoutes(codeDb, () => opts.logSink))`.
- Provision the `codes` rate-limit binding in `wrangler.toml` alongside the
  existing buckets.

### 6. Client — redemption `src/systems/CodeClient.ts`

`redeemCode(code: string): Promise<RedeemResult>`:

- Reads `getPlayerGuid()`, POSTs `RedeemCodeRequest` to
  `${VITE_HEAP_SERVER_URL}/codes/redeem` via the existing `fetchWithLog` wrapper.
- Maps HTTP status/error → a typed `RedeemResult`:
  `success` (with payload) | `already` | `expired` | `exhausted` | `notFound` |
  `offline` | `error`.
- **On `success`, applies the reward:** `coins` → `SaveData.addBalance(amount)`;
  `item` → validate `rewardId` against `ITEM_DEFS`, then `SaveData.addItem(rewardId, amount)`
  (unknown id ⇒ downgrade to an `error` result; no balance/inventory change).

Reward application lives here (or a thin helper) so the UI just shows the result.

### 7. Client — UI: rename "Dev" tab → "Player", reorganized

In `src/scenes/MenuScene.ts` settings panel. Current Dev tab
(`MenuScene.ts:761-777`) contains: `+ 500 Coins`, `Reset All Data` (+ warning),
Analytics checkbox. The new **Player** tab, top → bottom:

1. **Redeem Code** (very top) — label + text input (auto-uppercased) + **REDEEM**
   button + a result line reflecting the `RedeemResult`
   (e.g. "✓ +500 coins", "✓ +1 Shield", "Already redeemed", "Code expired",
   "Code not found", "Offline — try again").
2. **Analytics** checkbox (moved up, below Codes) — unchanged behavior
   (`setVerboseLogging` / `getLogger().setVerbose`), keeps its hint text.
3. **Reset All Data** (moved to the bottom) — button + "Clears all coins,
   upgrades and placed blocks." warning + the existing two-tap confirm flow.

**Removed:** the `+ 500 Coins` dev button (`coinBg`/`coinLabel` and its
`pointerup → addBalance(500)` handler) is deleted entirely. After removal the
only remaining `addBalance` source in MenuScene is gone — coins now come from
gameplay and codes.

Tab bar: relabel the display string "Dev" → "Player"; rename `showDevTab` →
`showPlayerTab` and the `dev*` vars → `player*` for readability. The tab's
item-array and Y offsets are recomputed for the new 3-block order.

Text input on Phaser: reuse whatever the codebase already uses for the player-name
editor (see `setPlayerName` flow in MenuScene) for consistency — a DOM input
overlay or the existing text-entry approach; don't introduce a new pattern.

### 8. Admin — minting UI `admin/index.html`

A new `<section>` "Reward Codes" with a `bootRewardCodes()` initializer, following
the file's existing single-file pattern (`adminFetch()` injects `X-Admin-Secret`,
`serverUrl()`, `setStatus()`):

- **Mint form:** code, reward type (dropdown coins/item), reward id (item
  dropdown — shown only when type=item, populated from a small static item-id
  list to avoid typos), amount, max redemptions, optional expiry →
  `adminFetch('/codes', { method: 'POST', body })`.
- **Codes table:** lists existing codes via `GET /codes` with
  `redeemed_count / max_redemptions`, expiry, and created date.

## Testing

- **Server (`server/tests/`):** `codeDb` + route tests —
  mint happy path; UPPERCASE normalization; duplicate-code rejection; redeem
  happy path for **coins** and **item**; expired; exhausted (`max_redemptions`
  reached); already-redeemed (same GUID twice); unknown code; atomicity of the
  `redeem` batch (concurrent/duplicate insert ⇒ exactly one redemption).
- **Client (`src/systems/__tests__/`):** `CodeClient` status-mapping (each HTTP
  outcome → correct `RedeemResult`) and reward application (coins → `addBalance`,
  item → `addItem`, unknown item id ⇒ `error` with no mutation), with `fetch` and
  `SaveData` mocked.

## Out of scope

- Upgrade/cosmetic rewards (only coins + items now).
- Server-authoritative balances.
- Bulk code generation CLI / random server-generated codes (admin picks strings).
- In-game discoverability beyond the Player settings tab.

## File-touch summary

**New:** `server/migrations/0008_reward_codes.sql`, `server/src/codeDb.ts`,
`server/src/routes/codes.ts`, `shared/codeTypes.ts`, `src/systems/CodeClient.ts`,
test files for each.
**Modified:** `server/schema.sql`, `server/src/app.ts`, `wrangler.toml`,
`src/scenes/MenuScene.ts`, `admin/index.html`.
