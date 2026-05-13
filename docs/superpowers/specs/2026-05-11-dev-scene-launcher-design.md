# Dev Scene Launcher + Playwright Preview Loop

**Date:** 2026-05-11  
**Status:** Approved

## Goal

Eliminate the manual "play through the game → screenshot → send to Claude" loop for UI iteration. Two pieces work together: a URL-based dev shortcut that drops straight into any scene, and a Playwright script that loads it at mobile dimensions and saves a screenshot Claude can read.

---

## Part 1 — BootScene Dev Shortcut

### Where it lives

`src/scenes/BootScene.ts` — after existing sync setup, before the async `HeapClient.list()` call.

### URL format

```
http://localhost:3000?dev=ScoreScene&params={"score":5000,"isFailure":true}
```

- `dev` — the exact Phaser scene key to launch
- `params` — URL-encoded JSON blob passed verbatim as the scene's `init(data)` argument. Optional; defaults to `{}`.

### Logic

```
if (import.meta.env.DEV && searchParams.has('dev')) {
  const sceneName = searchParams.get('dev')
  const params    = JSON.parse(searchParams.get('params') ?? '{}')
  this.scene.start(sceneName, params)
  return   // skip async catalog fetch entirely
}
// normal boot continues...
```

### Constraints

- Guard is `import.meta.env.DEV` — Vite tree-shakes this to dead code in production builds.
- Invalid JSON in `params` falls back to `{}` via try/catch; scene uses its own defaults.
- Unknown scene name produces Phaser's normal "scene not found" error — no special handling.
- No changes to any scene's `init()` — the parsed blob maps directly to the existing signature.

---

## Part 2 — Playwright Preview Script

### Where it lives

`scripts/preview-scene.ts`

### CLI usage

```bash
npm run preview -- ScoreScene '{"score":5000,"isFailure":true}' pixel7
```

Arguments (all positional):
1. Scene name — required
2. Params JSON — optional, defaults to `{}`
3. Device preset — optional, defaults to `pixel7`

### Device presets

| Name | Width | Height | deviceScaleFactor |
|---|---|---|---|
| `pixel7` | 412 | 915 | 2.6 |
| `iphone14` | 390 | 844 | 3.0 |
| `desktop` | 1280 | 800 | 1.0 |

### Script behaviour

1. Launch Chromium (headless)
2. Set viewport to the requested device preset
3. Navigate to `http://localhost:3000?dev=<scene>&params=<encoded>`
4. Wait for the Phaser `<canvas>` element to appear
5. Wait 2 seconds for opening animations to complete
6. Take a full-viewport screenshot
7. Save to `screenshots/preview.png` (gitignored)
8. Exit

### npm script

```json
"preview": "ts-node scripts/preview-scene.ts"
```

### Prerequisites

- Vite dev server running on port 3000 (`npm run dev` in a separate terminal)
- `@playwright/test` and `ts-node` installed as dev dependencies
- `screenshots/` directory gitignored

---

## Workflow

```
make UI change
  → npm run preview -- ScoreScene '{"score":171,"isFailure":true}'
  → Claude reads screenshots/preview.png
  → Claude sees result, makes next change
  → repeat
```

---

## Out of Scope

- Auto-starting the dev server from the script
- Multiple screenshots per run
- Playwright test assertions (this is a visual preview tool, not a test suite)
