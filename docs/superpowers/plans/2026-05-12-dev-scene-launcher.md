# Dev Scene Launcher + Playwright Preview Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a URL-based dev shortcut that drops straight into any Phaser scene, plus a Playwright script that loads it at mobile dimensions and saves a screenshot Claude can read.

**Architecture:** BootScene detects `?dev=SceneName&params={...}` in dev builds and calls `scene.start()` directly, skipping the async catalog fetch. A standalone `scripts/preview-scene.ts` script uses Playwright to navigate to that URL at a specified mobile viewport and saves `screenshots/preview.png`.

**Tech Stack:** Phaser 3, TypeScript, Vite (`import.meta.env.DEV`), `@playwright/test`, `tsx` (already installed)

---

## Files

| Action | Path | Purpose |
|---|---|---|
| Modify | `src/scenes/BootScene.ts` | Add dev shortcut after sync setup |
| Create | `scripts/preview-scene.ts` | Playwright screenshot script |
| Modify | `package.json` | Add `scene-preview` npm script, add `@playwright/test` dev dep |
| Modify | `.gitignore` | Add `screenshots/` |

> Note: `preview` is already taken by `vite preview` in package.json — the npm script is `scene-preview`.

---

## Task 1: Install Playwright and prep gitignore

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Install `@playwright/test`**

```bash
npm install --save-dev @playwright/test
```

Expected: `@playwright/test` appears in `devDependencies` in `package.json`.

- [ ] **Install the Chromium browser binary**

```bash
npx playwright install chromium
```

Expected: Chromium downloads and installs (~170MB). Output ends with `✔ Chromium ... Installed`.

- [ ] **Add `screenshots/` to `.gitignore`**

Append to `.gitignore`:
```
screenshots/
```

- [ ] **Create the screenshots directory**

```bash
mkdir -p screenshots && touch screenshots/.gitkeep
```

- [ ] **Commit**

```bash
git add package.json package-lock.json .gitignore screenshots/.gitkeep
git commit -m "chore: install playwright, gitignore screenshots dir"
```

---

## Task 2: Add dev shortcut to BootScene

**Files:**
- Modify: `src/scenes/BootScene.ts`

The check goes at the very top of `create()`, after `generateAllTextures(this)` and `initLogger()` but before the `HeapClient.list()` call. If `?dev=` is present, we start the target scene and `return` — the async catalog fetch never runs.

- [ ] **Add the dev shortcut block to `BootScene.create()`**

Open `src/scenes/BootScene.ts`. After the `initLogger()` call (currently around line 36) and before the `HeapClient.list()` call (currently around line 39), insert:

```typescript
    // Dev scene shortcut — only active in Vite dev mode, dead code in production builds.
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      const search = new URLSearchParams(window.location.search);
      if (search.has('dev')) {
        const sceneName = search.get('dev')!;
        let params: Record<string, unknown> = {};
        try {
          params = JSON.parse(search.get('params') ?? '{}');
        } catch {
          // invalid JSON — use empty params, scene falls back to its own defaults
        }
        this.scene.start(sceneName, params);
        return;
      }
    }
```

The final `create()` method should look like:

```typescript
  create(): void {
    generateAllTextures(this);

    this.game.registry.set('heapCatalog',    [] as HeapSummary[]);
    this.game.registry.set('activeHeapId',   '');
    this.game.registry.set('heapPolygon',    [] as Vertex[]);
    this.game.registry.set('heapParams',     DEFAULT_HEAP_PARAMS);
    this.game.registry.set('gameAssetsReady', false);
    this.game.registry.set('heapCatalogReady', false);

    initLogger();

    // Dev scene shortcut — only active in Vite dev mode, dead code in production builds.
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      const search = new URLSearchParams(window.location.search);
      if (search.has('dev')) {
        const sceneName = search.get('dev')!;
        let params: Record<string, unknown> = {};
        try {
          params = JSON.parse(search.get('params') ?? '{}');
        } catch {
          // invalid JSON — use empty params, scene falls back to its own defaults
        }
        this.scene.start(sceneName, params);
        return;
      }
    }

    HeapClient.list()
      // ... rest of method unchanged
```

- [ ] **Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Smoke test manually**

With `npm run dev` running, visit:
```
http://localhost:3000?dev=ScoreScene&params={"score":5000,"isFailure":false}
```
Expected: ScoreScene loads directly showing score 5000, no menu or boot screen.

Try with invalid JSON:
```
http://localhost:3000?dev=ScoreScene&params=notjson
```
Expected: ScoreScene loads with default/empty values (no crash).

- [ ] **Commit**

```bash
git add src/scenes/BootScene.ts
git commit -m "feat: add dev scene shortcut via URL params in BootScene"
```

---

## Task 3: Write the Playwright preview script

**Files:**
- Create: `scripts/preview-scene.ts`

- [ ] **Create `scripts/preview-scene.ts`**

```typescript
import { chromium } from '@playwright/test';

const DEVICES: Record<string, { width: number; height: number; deviceScaleFactor: number }> = {
  pixel7:  { width: 412, height: 915, deviceScaleFactor: 2.6 },
  iphone14: { width: 390, height: 844, deviceScaleFactor: 3.0 },
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1.0 },
};

const [,, sceneName, paramsArg = '{}', deviceName = 'pixel7'] = process.argv;

if (!sceneName) {
  console.error('Usage: npm run scene-preview -- <SceneName> [paramsJSON] [device]');
  console.error('Devices:', Object.keys(DEVICES).join(', '));
  process.exit(1);
}

const device = DEVICES[deviceName];
if (!device) {
  console.error(`Unknown device "${deviceName}". Available: ${Object.keys(DEVICES).join(', ')}`);
  process.exit(1);
}

const encodedParams = encodeURIComponent(paramsArg);
const url = `http://localhost:3000?dev=${sceneName}&params=${encodedParams}`;
const outPath = 'screenshots/preview.png';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport:          { width: device.width, height: device.height },
    deviceScaleFactor: device.deviceScaleFactor,
  });
  const page = await context.newPage();

  console.log(`Loading ${sceneName} at ${device.width}×${device.height} (${deviceName})...`);
  await page.goto(url);

  // Wait for Phaser canvas to appear
  await page.waitForSelector('canvas', { timeout: 10000 });

  // Wait for opening animations to settle
  await page.waitForTimeout(2000);

  await page.screenshot({ path: outPath, fullPage: false });
  await browser.close();

  console.log(`Screenshot saved to ${outPath}`);
})();
```

- [ ] **Add `scene-preview` script to `package.json`**

In the `"scripts"` block, add:
```json
"scene-preview": "tsx scripts/preview-scene.ts"
```

- [ ] **Commit**

```bash
git add scripts/preview-scene.ts package.json
git commit -m "feat: add playwright preview-scene script with mobile viewport presets"
```

---

## Task 4: End-to-end smoke test

- [ ] **Start the dev server in the background**

```bash
npm run dev &
```

Wait a few seconds for it to be ready (output will show `Local: http://localhost:3000`).

- [ ] **Run the preview script for a failure state**

```bash
npm run scene-preview -- ScoreScene '{"score":171,"isFailure":true,"checkpointAvailable":true}' pixel7
```

Expected output:
```
Loading ScoreScene at 412×915 (pixel7)...
Screenshot saved to screenshots/preview.png
```

- [ ] **Verify the screenshot exists and looks correct**

```bash
ls -lh screenshots/preview.png
```

Expected: file exists, size >50KB.

Open `screenshots/preview.png` to visually confirm ScoreScene is shown at mobile dimensions with the failure state.

- [ ] **Test the desktop preset**

```bash
npm run scene-preview -- ScoreScene '{"score":9000,"isPeak":true}' desktop
```

Expected: `screenshots/preview.png` updated, ScoreScene at 1280×800.

- [ ] **Stop the dev server**

```bash
kill %1
```

- [ ] **Commit any cleanup**

```bash
git add -A
git commit -m "chore: verify dev scene launcher end-to-end"
```

---

## Usage Reference

```bash
# Start dev server (keep running in separate terminal)
npm run dev

# Basic score screen — success
npm run scene-preview -- ScoreScene '{"score":5000}' pixel7

# Failure state with checkpoint
npm run scene-preview -- ScoreScene '{"score":171,"isFailure":true,"checkpointAvailable":true}' pixel7

# Peak run, new high score
npm run scene-preview -- ScoreScene '{"score":9000,"isPeak":true,"isNewHighScore":true}' pixel7

# iPhone 14 sizing
npm run scene-preview -- ScoreScene '{"score":5000}' iphone14

# Menu scene
npm run scene-preview -- MenuScene '{}' pixel7
```
