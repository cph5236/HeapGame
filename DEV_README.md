## SCENE PREVIEW

Take a screenshot of any game scene at phone dimensions without playing through the game. Useful for UI iteration and checking layout changes quickly.

### Setup

Start the dev server (keep running):
```bash
npm run dev
```

### Usage

```bash
npm run scene-preview -- <SceneName> '<paramsJSON>' <device|all|headed>
```

| Mode | Output | Use for |
|---|---|---|
| `pixel7` / `iphone14` / etc. | `screenshots/preview.png` | quick single-device iteration |
| `all` | `screenshots/SceneName-{device}.png` × 4 | cross-device layout audit, runs in parallel |
| `headed` | opens browser window | interactive — click on things, test animations |

### Device presets

| Name | Size | Notes |
|---|---|---|
| `pixel7` | 448×970 | default — matches the test phone |
| `browser` | 480×1042 | browser pane size |
| `iphone14` | 390×844 | iOS reference |
| `desktop` | 1280×800 | wide layout |

### Examples

```bash
# Quick iteration — single device
npm run scene-preview -- ScoreScene '{"score":5000}' pixel7

# Cross-device layout audit — all four at once
npm run scene-preview -- ScoreScene '{"score":5000}' all

# Interactive — opens browser so you can click and test
npm run scene-preview -- ScoreScene '{"score":5000}' headed
```

#### Full ScoreScene loadout — leaderboard + coin panel

```bash
npm run scene-preview -- ScoreScene '{"score":5240,"isFailure":true,"checkpointAvailable":true,"mockLeaderboard":{"top":[{"rank":1,"playerId":"a","name":"105; Drop Table test","score":9819},{"rank":2,"playerId":"b","name":"Trashbag#44217","score":6186},{"rank":3,"playerId":"c","name":"Mincono","score":4393},{"rank":4,"playerId":"d","name":"Trashbag#06230","score":2641},{"rank":5,"playerId":"e","name":"Trashbag#08567","score":904}],"player":{"rank":6,"playerId":"you","name":"You","score":5240}}}' all
```

#### Full ScoreScene loadout — leaderboard + score breakdown overlay

The score breakdown requires `baseHeightPx` > 0. Pass `forceBreakdownOpen: true` to auto-open the overlay for screenshots:

```bash
npm run scene-preview -- ScoreScene '{"score":5240,"baseHeightPx":4800,"kills":{"percher":3,"ghost":1},"elapsedMs":95000,"mockLeaderboard":{"top":[{"rank":1,"playerId":"a","name":"105; Drop Table test","score":9819},{"rank":2,"playerId":"b","name":"Trashbag#44217","score":6186},{"rank":3,"playerId":"c","name":"Mincono","score":4393},{"rank":4,"playerId":"d","name":"Trashbag#06230","score":2641},{"rank":5,"playerId":"e","name":"Trashbag#08567","score":904}],"player":{"rank":6,"playerId":"you","name":"You","score":5240}},"forceBreakdownOpen":true}' all
```

Or use `headed` to tap the score yourself and see the animation:

```bash
npm run scene-preview -- ScoreScene '{"score":5240,"baseHeightPx":4800,"kills":{"percher":3,"ghost":1},"elapsedMs":95000}' headed
```

### How it works

BootScene detects `?dev=SceneName&params={...}` in the URL (dev builds only) and starts that scene directly with the given params — skipping the normal boot/menu flow. The params blob is passed verbatim to the scene's `init()` method, so any scene works out of the box with no changes.

The Playwright script (`scripts/preview-scene.ts`) builds that URL, loads it in headless Chromium (or headed for interactive use), waits for the canvas to render, and saves the screenshot.

---

## REMOTE LOGGING

### Local dev

The `[[analytics_engine_datasets]]` binding in `server/wrangler.toml` is intentionally **commented out**. This forces `wrangler dev` to use the local D1 database as the log sink.

Start the server as normal:
```bash
cd server && npx wrangler dev
```

After playing the game, query logs:
```bash
npx wrangler d1 execute heap --local \
  --command "SELECT level, event_type, message, payload FROM logs ORDER BY id DESC LIMIT 20"
```

Analytics events only appear when **"Send anonymous gameplay analytics"** is toggled ON in Menu → Settings. Errors and warnings always ship regardless.

---

### Production (Cloudflare Analytics Engine)

In the Cloudflare dashboard: **Storage & Databases → Analytics Engine → Studio → heap_logs**

Column mapping (`AnalyticsEngineSink` write order):

| Column | Field |
|---|---|
| `index1` | `user_guid` |
| `blob1` | `level` (`event` / `warn` / `error`) |
| `blob2` | `event_type` or `message` |
| `blob3` | `platform` |
| `blob4` | `app_version` |
| `blob5` | `session_id` |
| `blob6` | `payload` (JSON string) |
| `blob7` | `user_agent` |
| `double1` | `client_ts` (ms) |

```sql
SELECT
  timestamp,
  blob1  AS level,
  blob2  AS event_type,
  blob3  AS platform,
  blob4  AS app_version,
  blob5  AS session_id,
  blob6  AS payload,
  blob7  AS user_agent,
  double1 AS client_ts,
  index1 AS user_guid
FROM heap_logs
WHERE blob1 = 'event'
ORDER BY timestamp DESC
LIMIT 50
```

Swap `WHERE blob1 = 'event'` for `'warn'` or `'error'` to filter by level.

---

## THE Brain PLUGIN
https://github.com/Advenire-Consulting/thebrain

Start a new Claude session — the tool-index, prefrontal rules, and code navigation only load on fresh session starts.

Commands you now have:

Command	When to use it
/hello	Start of a session — orients me on what you've been working on
/continue	After context compaction, or to resume a project
/wrapup	End of a session — saves context for next time
/dopamine +	Something went well — reinforce the pattern
/dopamine -	Something went wrong — flag it
/oxytocin	A collaboration dynamic worth capturing
The brain gets smarter the more you use /dopamine and /oxytocin. Start with /wrapup — that's the most important habit.

Before we wrap, want to do alias triage? The scan found some well-connected files (like GameScene.ts with 15 connections, HeapPolygon.ts with 10) that are good candidates for short conversational names. It makes navigation faster — you can say "show me the heap polygon" instead of remembering the path. Or skip it for now, you can always add aliases later.