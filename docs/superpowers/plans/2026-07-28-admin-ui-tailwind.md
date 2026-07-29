# Admin UI — Tailwind Restyle + Environment Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle `admin/index.html` onto Tailwind and replace the free-text server URL with an environment dropdown that remembers a separate admin secret per environment, plus an eye toggle on the secret field.

**Architecture:** `admin/index.html` is a single standalone static file — inline `<style>`, inline `<script>`, no imports, no bundler, opened directly from disk. All work stays inside that one file. Tailwind arrives via the v4 browser CDN script and an inline `<style type="text/tailwindcss">` block holding an `@theme` (terminal palette tokens) and an `@layer components` set, so ~70 form controls carry one class each instead of a utility pile. Environment state moves from two flat `localStorage` keys to an env id plus a per-env secrets map, with a one-time migration from the old keys.

**Tech Stack:** Plain HTML/JS (no framework, no build step), Tailwind CSS v4 via `@tailwindcss/browser`, `localStorage`, Playwright for verification.

**Spec:** `docs/superpowers/specs/2026-07-28-admin-ui-tailwind-design.md`

## Global Constraints

- **The file must stay standalone and double-clickable from `file://`.** No `type="module"` scripts (module imports are CORS-blocked on `file://`), no build step, no new entry in `package.json`.
- **No server changes.** No new routes, no changes to any request path, payload, header, or response handling. `adminFetch` keeps sending `X-Admin-Secret`.
- **Preserve exactly:** `KINDS`, `FIELDS`, `KIND_DEFAULTS`, `ITEM_IDS`, `INFINITE_HEAP_ID`, every `escapeHtml` call site, and the global-function `onclick` pattern used by generated table rows (`onEditHeap`, `onDeleteHeap`, `onSaveConfigKey`, `onDeleteConfigKey`).
- **Environment URLs** (verified live 2026-07-28, `GET /heaps` → 200):
  - local — `http://localhost:8787`
  - staging — `https://heap-server-staging.hanlinsoftwaresws.workers.dev`
  - prod — `https://heap-server.hanlinsoftwaresws.workers.dev`
- **localStorage keys:** `heapAdmin.env`, `heapAdmin.customUrl`, `heapAdmin.secrets`. Legacy keys `heapAdmin.serverUrl` and `heapAdmin.adminSecret` are migrated then deleted.
- **Branch:** `feature/admin-ui-tailwind`. Never push directly to main; PR at the end.
- Tailwind CDN URL, used verbatim: `https://unpkg.com/@tailwindcss/browser@4`

## Background for the implementer

**Running a local server for verification.** Open a second terminal:

```bash
cd server && npx wrangler dev
```

That serves `http://localhost:8787` against local D1 replicas. If it has no heaps, run `npm run seed` from the repo root. `.wrangler/state/` is local D1 state — never commit it.

**Opening the page.** There is no dev server for `admin/`. Open it directly:

```
file:///home/connor/Documents/Repos/HeapGame/admin/index.html
```

CORS is not an obstacle: production sets `ALLOWED_ORIGINS = "*"` (`server/wrangler.toml:49`), and a `file://` page sends `Origin: null`, which the allow-all branch echoes back.

**Why there are no unit tests here.** The page is one file with no module boundary — nothing can be imported, so there is nothing for Vitest to load. Verification for every task is a browser check, spelled out step by step. `npm test` and `npm run build` never touch this file; they are run once at the end purely as a regression check.

**Verification uses Playwright MCP tools** (`browser_navigate`, `browser_evaluate`, `browser_snapshot`, `browser_take_screenshot`, `browser_click`, `browser_select_option`). Where a step says "run in the browser", use `browser_evaluate`.

## File Structure

| File | Responsibility |
|------|----------------|
| `admin/index.html` (modify) | Everything. Sole deliverable file. |
| `Todo/Todo.md` (modify, Task 5) | Strike the completed admin QoL line. |

Within `admin/index.html` the script keeps its existing section-comment structure (`────── Settings ──────` etc.). New environment code forms a new section placed **above** Settings, since Settings depends on it.

---

### Task 1: Tailwind bootstrap + theme, header, Settings and Heaps cards

Loads Tailwind, defines the design tokens and component classes, and converts the top of the page. Behavior is unchanged in this task — every control still does exactly what it did.

**Files:**
- Modify: `admin/index.html` — replace `<style>` block (lines 6-37), `<h1>` + Settings section (lines 40-55), Heaps section (57-68), and the `setStatus` / `refreshSecretIndicator` helpers.

**Interfaces:**
- Consumes: nothing.
- Produces: CSS component classes `.card`, `.card-head`, `.card-sub`, `.lbl`, `.field`, `.btn`, `.btn-sm`, `.btn-danger`, `.btn-ghost`, `.grid2`, `.tbl`, `.badge`, `.dot`, `.dot-ok`, `.muted`. JS constant `STATUS_BASE` (string of Tailwind classes) and the rewritten `setStatus(msg, kind)` where `kind` is `'ok' | 'err' | undefined`.

- [ ] **Step 1: Replace the `<head>` style block**

Replace lines 6-37 (the entire `<style>…</style>`) with:

```html
  <script src="https://unpkg.com/@tailwindcss/browser@4"></script>
  <style type="text/tailwindcss">
    @theme {
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      --color-term-bg:     #0a0a0a;
      --color-term-panel:  #151515;
      --color-term-line:   #2a2a2a;
      --color-term-text:   #dddddd;
      --color-term-dim:    #777777;
      --color-term-green:  #00ff00;
      --color-term-cyan:   #00ccff;
      --color-term-amber:  #ffaa00;
      --color-term-violet: #aa00ff;
      --color-term-red:    #ff4444;
    }

    @layer base {
      html { @apply bg-term-bg; }
    }

    @layer components {
      .card      { @apply mb-4 rounded-r border-l-4 border-term-line bg-term-panel p-4; }
      .card-head { @apply mb-3 text-sm uppercase tracking-widest text-term-cyan; }
      .card-sub  { @apply mt-5 mb-2 text-xs uppercase tracking-widest text-term-dim; }
      .lbl       { @apply mb-1 block text-xs text-term-dim; }
      .field     { @apply w-full rounded-sm border border-term-line bg-black px-2 py-1.5 text-sm
                          text-term-text outline-none focus:border-term-green
                          focus:ring-1 focus:ring-term-green disabled:opacity-40; }
      .btn       { @apply mt-3 cursor-pointer rounded-sm bg-term-green px-5 py-2 text-sm
                          font-bold text-black hover:brightness-90 active:brightness-75; }
      .btn-sm    { @apply mt-0 px-2.5 py-1 text-xs; }
      .btn-danger{ @apply bg-term-red text-white; }
      .btn-ghost { @apply mt-0 bg-transparent text-term-dim hover:text-term-text; }
      .grid2     { @apply grid grid-cols-1 gap-3 md:grid-cols-2; }
      .tbl       { @apply w-full border-collapse text-sm; }
      .tbl th    { @apply border-b border-term-line px-2 py-1.5 text-left text-xs
                          uppercase tracking-wider text-term-dim; }
      .tbl td    { @apply border-b border-term-line/60 px-2 py-1.5 align-middle; }
      .tbl tbody tr:nth-child(even) { @apply bg-white/[0.02]; }
      .tbl tbody tr:hover           { @apply bg-term-green/5; }
      .badge     { @apply inline-flex items-center gap-1.5 rounded-sm border border-term-line
                          px-2 py-0.5 text-xs text-term-dim; }
      .dot       { @apply inline-block h-2.5 w-2.5 rounded-full bg-term-red align-middle; }
      .dot-ok    { @apply bg-term-green; }
      .muted     { @apply text-xs text-term-dim; }
    }
  </style>
```

- [ ] **Step 2: Convert `<body>` open tag and header**

Replace line 39 (`<body>`) and line 40 (`<h1>Heap Admin</h1>`) with:

```html
<body class="mx-auto min-h-screen max-w-5xl px-4 pb-16 font-mono text-term-text">
  <header class="sticky top-0 z-20 -mx-4 mb-4 border-b border-term-line bg-term-bg/95 px-4 py-3 backdrop-blur">
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-lg font-bold tracking-widest text-term-green">HEAP ADMIN</h1>
      <div class="ml-auto flex items-center gap-2">
        <span id="envDot" class="dot"></span>
      </div>
    </div>
  </header>
```

(The env selector lands in this header in Task 3; `#envDot` is placed now so the markup is stable.)

- [ ] **Step 3: Convert the Settings card**

Replace lines 42-55 (`<div class="section section-settings"> … </div>`) with:

```html
  <div class="card border-l-term-dim">
    <h2 class="card-head">Settings</h2>
    <label class="lbl">Server URL</label>
    <input type="text" id="serverUrl" class="field" />

    <label class="lbl mt-3">Admin Secret <span class="muted">(stored in localStorage)</span></label>
    <input type="password" id="adminSecret" class="field" placeholder="leave blank if server has no secret" />

    <div class="mt-3 flex items-center gap-2">
      <button id="saveSettings" class="btn">Save Settings</button>
      <span id="secretDot" class="dot"></span>
      <span id="secretLabel" class="muted">no secret saved</span>
    </div>
  </div>
```

- [ ] **Step 4: Convert the Heaps card**

Replace lines 57-68 with:

```html
  <div class="card border-l-term-cyan">
    <div class="flex items-center justify-between">
      <h2 class="card-head">Heaps</h2>
      <button id="refreshHeaps" class="btn btn-sm">Refresh</button>
    </div>
    <table class="tbl">
      <thead>
        <tr>
          <th>Name</th><th>Difficulty</th><th>top Y</th><th>Created</th><th>Actions</th>
        </tr>
      </thead>
      <tbody id="heapsTbody"><tr><td colspan="5" class="muted">loading…</td></tr></tbody>
    </table>
  </div>
```

- [ ] **Step 5: Fix `setStatus` so it stops destroying its own classes**

`setStatus` currently does `el.className = kind || ''`, which would wipe the Tailwind classes off the status element the first time it runs. Replace the function (currently lines 272-277) with:

```js
    const STATUS_BASE = 'fixed inset-x-0 bottom-0 z-30 border-t border-term-line '
                      + 'bg-term-panel px-4 py-2 text-sm';

    function setStatus(msg, kind) {
      const el = $('status');
      if (!el) return;
      el.textContent = msg;
      const tone = kind === 'ok' ? 'text-term-green'
                 : kind === 'err' ? 'text-term-red'
                 : 'text-term-dim';
      el.className = STATUS_BASE + ' ' + tone;
    }
```

And replace the status element (line 224) with:

```html
  <div id="status" class="fixed inset-x-0 bottom-0 z-30 border-t border-term-line bg-term-panel px-4 py-2 text-sm text-term-dim"></div>
```

- [ ] **Step 6: Update `refreshSecretIndicator` for the new dot classes**

Replace its body's first two lines (currently lines 251-253) so the dot uses the component classes:

```js
    function refreshSecretIndicator() {
      const has = !!localStorage.getItem(LS_SECRET);
      $('secretDot').className = 'dot' + (has ? ' dot-ok' : '');
      $('secretLabel').textContent = has ? 'secret saved' : 'no secret saved';
    }
```

- [ ] **Step 7: Verify in the browser**

Start the local worker (`cd server && npx wrangler dev`), then:

1. `browser_navigate` to `file:///home/connor/Documents/Repos/HeapGame/admin/index.html`
2. `browser_take_screenshot` — expect: black page, monospace, green `HEAP ADMIN` header, two styled cards, status bar pinned to the bottom.
3. Run in the browser and expect a non-zero number (proves Tailwind compiled, not just loaded):

```js
document.querySelectorAll('style').length
  && getComputedStyle(document.querySelector('.card')).borderLeftWidth
```

Expected: `"4px"`.

4. Click Refresh; the heaps table populates from the local worker.

Note: the sections below Settings/Heaps are still on the old markup and will look unstyled — that is expected until Task 2.

- [ ] **Step 8: Commit**

```bash
git add admin/index.html
git commit -m "style(admin): load Tailwind and restyle header, settings, heaps card"
```

---

### Task 2: Restyle remaining sections + sticky status + scroll-into-view

Finishes the visual pass: edit panel, create, reward codes, remote config. Still no behavior change beyond scrolling the edit panel into view.

**Files:**
- Modify: `admin/index.html` — edit panel (lines 70-149), create (151-182), codes (184-210), config (212-222), `showEditPanel`, `renderConfigRows`, `renderHeapsTable`.

**Interfaces:**
- Consumes: component classes from Task 1.
- Produces: `showEditPanel(heap, opts)` where `opts` is `{ scroll?: boolean }` defaulting to `{}` — Task 5 relies on this signature.

- [ ] **Step 1: Convert the edit panel shell and heap params**

Replace lines 70-98 with:

```html
  <div class="card border-l-term-green" id="editPanel" style="display:none;">
    <h2 class="card-head">Edit Heap: <span id="editHeapName" class="text-term-text">—</span></h2>

    <h3 class="card-sub">Heap Params</h3>
    <div class="grid2">
      <div><label class="lbl">Name</label><input type="text" id="ep-name" class="field" /></div>
      <div><label class="lbl">Difficulty (1–5, step 0.5)</label><input type="number" step="0.5" id="ep-difficulty" class="field" /></div>
      <div><label class="lbl">spawnRateMult</label><input type="number" step="0.05" id="ep-spawnRateMult" class="field" /></div>
      <div><label class="lbl">coinMult</label><input type="number" step="0.05" id="ep-coinMult" class="field" /></div>
      <div><label class="lbl">scoreMult</label><input type="number" step="0.05" id="ep-scoreMult" class="field" /></div>
      <div><label class="lbl">ghostPointCount</label><input type="number" step="1" min="0" id="ep-ghostPointCount" class="field" /></div>
      <div><label class="lbl">baseItemSpawnRate (0–1)</label><input type="number" step="0.05" min="0" max="1" id="ep-baseItemSpawnRate" class="field" /></div>
      <div><label class="lbl">positiveItemSpawnRate (weight)</label><input type="number" step="0.05" min="0" id="ep-positiveItemSpawnRate" class="field" /></div>
      <div><label class="lbl">negativeItemSpawnRate (weight)</label><input type="number" step="0.05" min="0" id="ep-negativeItemSpawnRate" class="field" /></div>
      <div><label class="lbl">Locked by <span class="muted">(player must beat first)</span></label><select id="ep-lockedBy" class="field"></select></div>
      <div><label class="lbl">worldHeight <span class="muted">(locked)</span></label><input type="number" id="ep-worldHeight" class="field" disabled /></div>
    </div>
    <button id="saveParams" class="btn">Save Params</button>
```

The old fixed pairs of `.row` divs collapse into one `.grid2` flow — the empty spacer `<div></div>` elements are dropped, since a single-column-on-mobile grid no longer needs them.

- [ ] **Step 2: Convert the three enemy-param sections**

Replace lines 100-149 with:

```html
    <h3 class="card-sub">Enemy Params</h3>
    <div class="card border-l-term-line" id="section-percher">
      <h2 class="card-head">Percher (RAT)</h2>
      <div class="grid2">
        <div><label class="lbl">spawnStartPxAboveFloor</label><input type="number" id="percher-spawnStartPxAboveFloor" class="field" /></div>
        <div><label class="lbl">spawnEndPxAboveFloor (-1 = none)</label><input type="number" id="percher-spawnEndPxAboveFloor" class="field" /></div>
        <div><label class="lbl">spawnRampPxAboveFloor (-1 = flat)</label><input type="number" id="percher-spawnRampPxAboveFloor" class="field" /></div>
        <div></div>
        <div><label class="lbl">spawnChanceMin (0–1)</label><input type="number" step="0.01" id="percher-spawnChanceMin" class="field" /></div>
        <div><label class="lbl">spawnChanceMax (0–1)</label><input type="number" step="0.01" id="percher-spawnChanceMax" class="field" /></div>
      </div>
    </div>

    <div class="card border-l-term-line" id="section-ghost">
      <h2 class="card-head">Ghost (VULTURE)</h2>
      <div class="grid2">
        <div><label class="lbl">spawnStartPxAboveFloor</label><input type="number" id="ghost-spawnStartPxAboveFloor" class="field" /></div>
        <div><label class="lbl">spawnEndPxAboveFloor (-1 = none)</label><input type="number" id="ghost-spawnEndPxAboveFloor" class="field" /></div>
        <div><label class="lbl">spawnRampPxAboveFloor (-1 = flat)</label><input type="number" id="ghost-spawnRampPxAboveFloor" class="field" /></div>
        <div></div>
        <div><label class="lbl">spawnChanceMin (0–1)</label><input type="number" step="0.01" id="ghost-spawnChanceMin" class="field" /></div>
        <div><label class="lbl">spawnChanceMax (0–1)</label><input type="number" step="0.01" id="ghost-spawnChanceMax" class="field" /></div>
      </div>
    </div>

    <div class="card border-l-term-line" id="section-jumper">
      <h2 class="card-head">Jumper (JUMPER CABLES) <span class="muted">— wall enemy</span></h2>
      <div class="grid2">
        <div><label class="lbl">spawnStartPxAboveFloor</label><input type="number" id="jumper-spawnStartPxAboveFloor" class="field" /></div>
        <div><label class="lbl">spawnEndPxAboveFloor (-1 = none)</label><input type="number" id="jumper-spawnEndPxAboveFloor" class="field" /></div>
        <div><label class="lbl">spawnRampPxAboveFloor (-1 = flat)</label><input type="number" id="jumper-spawnRampPxAboveFloor" class="field" /></div>
        <div></div>
        <div><label class="lbl">spawnChanceMin (0–1)</label><input type="number" step="0.01" id="jumper-spawnChanceMin" class="field" /></div>
        <div><label class="lbl">spawnChanceMax (0–1)</label><input type="number" step="0.01" id="jumper-spawnChanceMax" class="field" /></div>
      </div>
    </div>
    <button id="saveEnemyParams" class="btn">Save Enemy Params</button>
  </div>
```

The `<div></div>` spacers here are deliberate: they keep `spawnRampPxAboveFloor` alone on its row, matching the current layout where ramp sits by itself.

Element IDs are unchanged, so `loadEnemyParams` and `saveEnemyParams` keep working untouched.

- [ ] **Step 3: Convert the Create card**

Replace lines 151-182 with:

```html
  <div class="card border-l-term-amber">
    <h2 class="card-head">Create New Heap</h2>
    <div class="grid2">
      <div><label class="lbl">Name</label><input type="text" id="cp-name" class="field" placeholder="Heap name" /></div>
      <div><label class="lbl">Difficulty</label><input type="number" step="0.5" id="cp-difficulty" class="field" value="1.0" /></div>
      <div><label class="lbl">spawnRateMult</label><input type="number" step="0.05" id="cp-spawnRateMult" class="field" value="1.0" /></div>
      <div><label class="lbl">coinMult</label><input type="number" step="0.05" id="cp-coinMult" class="field" value="1.0" /></div>
      <div><label class="lbl">scoreMult</label><input type="number" step="0.05" id="cp-scoreMult" class="field" value="1.0" /></div>
      <div><label class="lbl">ghostPointCount</label><input type="number" step="1" min="0" id="cp-ghostPointCount" class="field" value="1" /></div>
      <div><label class="lbl">baseItemSpawnRate (0–1)</label><input type="number" step="0.05" min="0" max="1" id="cp-baseItemSpawnRate" class="field" value="0.33" /></div>
      <div><label class="lbl">positiveItemSpawnRate (weight)</label><input type="number" step="0.05" min="0" id="cp-positiveItemSpawnRate" class="field" value="0.15" /></div>
      <div><label class="lbl">negativeItemSpawnRate (weight)</label><input type="number" step="0.05" min="0" id="cp-negativeItemSpawnRate" class="field" value="0.85" /></div>
      <div><label class="lbl">worldHeight</label><input type="number" id="cp-worldHeight" class="field" value="50000" /></div>
      <div><label class="lbl">Seed <span class="muted">(blank = random)</span></label><input type="number" id="cp-seed" class="field" /></div>
      <div><label class="lbl">Num Blocks <span class="muted">(blank = 50)</span></label><input type="number" step="1" min="1" id="cp-numBlocks" class="field" /></div>
    </div>
    <button id="createHeap" class="btn">Create Heap</button>
  </div>
```

- [ ] **Step 4: Convert the Reward Codes card**

Replace lines 184-210 with:

```html
  <div class="card border-l-term-violet">
    <h2 class="card-head">Reward Codes</h2>
    <div class="grid2">
      <div><label class="lbl">Code</label><input type="text" id="rc-code" class="field" placeholder="LAUNCH2026" /></div>
      <div><label class="lbl">Reward Type</label>
        <select id="rc-type" class="field">
          <option value="coins">coins</option>
          <option value="item">item</option>
        </select>
      </div>
      <div id="rc-item-wrap" style="display:none"><label class="lbl">Item</label>
        <select id="rc-item" class="field"></select>
      </div>
      <div><label class="lbl">Amount</label><input type="number" step="1" min="1" id="rc-amount" class="field" value="500" /></div>
      <div><label class="lbl">Max Redemptions <span class="muted">(0 = unlimited)</span></label><input type="number" step="1" min="0" id="rc-max" class="field" value="0" /></div>
      <div><label class="lbl">Expires At <span class="muted">(blank = never)</span></label><input type="datetime-local" id="rc-expires" class="field" /></div>
    </div>
    <button id="rc-create" class="btn">Mint Code</button>
    <table class="tbl mt-4">
      <thead><tr><th>Code</th><th>Reward</th><th>Redeemed</th><th>Expires</th><th>Created</th></tr></thead>
      <tbody id="rc-tbody"><tr><td colspan="5" class="muted">not loaded</td></tr></tbody>
    </table>
  </div>
```

- [ ] **Step 5: Convert the Remote Config card**

Replace lines 212-222 with:

```html
  <div class="card border-l-term-violet">
    <h2 class="card-head">Remote Config</h2>
    <div id="cfg-rows"></div>
    <h3 class="card-sub">Add New Key</h3>
    <div class="grid2">
      <div><label class="lbl">Key name</label><input type="text" id="cfg-newKey" class="field" placeholder="my_new_key" /></div>
    </div>
    <label class="lbl mt-3">Value (JSON)</label>
    <textarea id="cfg-newValue" rows="4" class="field"></textarea>
    <button id="cfg-create" class="btn">Create</button>
  </div>
```

- [ ] **Step 6: Restyle the two generated-HTML renderers**

In `renderHeapsTable`, the action buttons need the component classes. Replace the two `<button>` lines inside the template literal with:

```js
            <button class="btn btn-sm" onclick="onEditHeap('${h.id}')">Edit</button>
            <button class="btn btn-sm btn-danger" onclick="onDeleteHeap('${h.id}')">×</button>
```

In `renderConfigRows`, replace the returned template literal with:

```js
        return `<div class="mb-3 rounded-sm border border-term-line p-3">
          <div class="flex items-center justify-between">
            <strong class="text-term-text">${escapeHtml(key)}</strong>
            <button class="btn btn-sm btn-danger" onclick="onDeleteConfigKey('${escapeHtml(key)}')">Delete</button>
          </div>
          <textarea class="cfg-value field mt-2" data-key="${escapeHtml(key)}" rows="4">${pretty}</textarea>
          <button class="btn btn-sm" onclick="onSaveConfigKey('${escapeHtml(key)}')">Save</button>
        </div>`;
```

The `cfg-value` class and `data-key` attribute must survive — `onSaveConfigKey` selects on `textarea.cfg-value[data-key="…"]`.

- [ ] **Step 7: Scroll the edit panel into view when opened**

Give `showEditPanel` an options argument and scroll only when asked. Change the signature (line 360) and add the scroll at the end of the function body, just before `loadEnemyParams(heap.id);`:

```js
    function showEditPanel(heap, opts = {}) {
      editingHeapId = heap.id;
      $('editPanel').style.display = '';
      // … existing field assignments unchanged …
      lockSel.value = heap.params.lockedByHeapId ?? '';
      if (opts.scroll) $('editPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      loadEnemyParams(heap.id);
    }
```

Then update the caller in `onEditHeap` to opt in:

```js
    function onEditHeap(id) {
      const heap = cachedHeaps.find(h => h.id === id);
      if (heap) showEditPanel(heap, { scroll: true });
    }
```

The other caller — the refresh at the end of `onSaveParams` — is deliberately left without `scroll`, so saving params does not yank the viewport.

- [ ] **Step 8: Verify in the browser**

With the local worker running:

1. `browser_navigate` to the file URL, then `browser_take_screenshot` (full page) — expect every section styled, no unstyled leftovers.
2. Click Edit on a heap. Expect: panel opens, viewport scrolls to it, all enemy-param fields are populated (not blank).
3. Click Save Params. Expect status bar reads `params saved` in green, and the viewport does *not* jump.
4. Switch `Reward Type` to `item`. Expect the Item dropdown appears.
5. `browser_resize` to 500×900 and screenshot. Expect single-column forms and no horizontal page scroll. Confirm with:

```js
document.documentElement.scrollWidth <= document.documentElement.clientWidth
```

Expected: `true`.

- [ ] **Step 9: Commit**

```bash
git add admin/index.html
git commit -m "style(admin): restyle edit, create, codes and config sections"
```

---

### Task 3: Environment dropdown

Replaces the free-text server URL as the primary control. Custom URLs remain available.

**Files:**
- Modify: `admin/index.html` — header markup, Settings card, script constants (lines 227-229), `serverUrl()`, `bootSettings()`.

**Interfaces:**
- Consumes: `showEditPanel(heap, opts)`, `setStatus(msg, kind)`.
- Produces: `ENVS` (object keyed by `'local' | 'staging' | 'prod' | 'custom'`, each `{ label, url }` with `url: null` for custom), `LS_ENV`, `LS_CUSTOM_URL`, `currentEnv(): string`, `stripSlash(u): string`, `envLabel(): string`, `applyEnv(env): void`.

- [ ] **Step 1: Replace the storage constants**

Replace lines 227-229 with:

```js
    const LS_ENV        = 'heapAdmin.env';
    const LS_CUSTOM_URL = 'heapAdmin.customUrl';
    const LS_SECRETS    = 'heapAdmin.secrets';
    // Legacy single-env keys, migrated then deleted on first boot (migrateLegacySettings).
    const LS_LEGACY_URL    = 'heapAdmin.serverUrl';
    const LS_LEGACY_SECRET = 'heapAdmin.adminSecret';

    // Known deployments. Staging and production are separate Workers with
    // separate ADMIN_SECRETs — see server/wrangler.toml.
    const ENVS = {
      local:   { label: 'Local',      url: 'http://localhost:8787' },
      staging: { label: 'Staging',    url: 'https://heap-server-staging.hanlinsoftwaresws.workers.dev' },
      prod:    { label: 'Production', url: 'https://heap-server.hanlinsoftwaresws.workers.dev' },
      custom:  { label: 'Custom…',    url: null },
    };
```

`LS_SECRETS` is declared here but not used until Task 4.

- [ ] **Step 2: Add the environment section to the script**

Insert this immediately above the `// ────── Settings ──────` comment:

```js
    // ────── Environment ─────────────────────────────────────────────────────

    function stripSlash(u) { return String(u || '').replace(/\/$/, ''); }

    function currentEnv() {
      const env = localStorage.getItem(LS_ENV);
      return Object.prototype.hasOwnProperty.call(ENVS, env) ? env : 'local';
    }

    function envLabel() { return ENVS[currentEnv()].label; }

    function applyEnv(env) {
      localStorage.setItem(LS_ENV, env);
      $('envSelect').value = env;
      $('customUrlWrap').style.display = env === 'custom' ? '' : 'none';
      if (env === 'custom') $('serverUrl').value = localStorage.getItem(LS_CUSTOM_URL) || '';
      $('envUrl').textContent = serverUrl() || '(no url set)';
      hideEditPanel();
      loadHeaps();
      loadCodes();
      loadConfig();
    }

    function bootEnv() {
      $('envSelect').innerHTML = Object.keys(ENVS)
        .map(k => `<option value="${k}">${escapeHtml(ENVS[k].label)}</option>`)
        .join('');
      $('envSelect').onchange = () => applyEnv($('envSelect').value);
      $('serverUrl').onchange = () => {
        localStorage.setItem(LS_CUSTOM_URL, $('serverUrl').value);
        $('envUrl').textContent = serverUrl() || '(no url set)';
      };
    }
```

- [ ] **Step 3: Rewrite `serverUrl()` to read the env**

Replace line 247:

```js
    function serverUrl() {
      const env = currentEnv();
      return stripSlash(env === 'custom' ? $('serverUrl').value : ENVS[env].url);
    }
```

- [ ] **Step 4: Add the selector to the header**

In the header block from Task 1, replace the `ml-auto` div with:

```html
      <div class="ml-auto flex items-center gap-2">
        <select id="envSelect" class="field w-auto"></select>
        <span id="envDot" class="dot"></span>
      </div>
```

and add the URL readout as the last child of `<header>`, after the closing `</div>` of the flex row:

```html
    <div class="mt-1 text-xs text-term-dim" id="envUrl">—</div>
```

- [ ] **Step 5: Wrap the Server URL input so it can hide**

In the Settings card, replace the Server URL label + input with:

```html
    <div id="customUrlWrap" style="display:none">
      <label class="lbl">Custom Server URL</label>
      <input type="text" id="serverUrl" class="field" placeholder="http://localhost:8787" />
    </div>
```

- [ ] **Step 6: Boot the env before Settings**

`bootSettings` currently seeds `$('serverUrl').value` from `LS_URL`, which no longer exists. Replace `bootSettings` (lines 286-296) with:

```js
    function bootSettings() {
      $('saveSettings').onclick = () => {
        if (currentEnv() === 'custom') {
          localStorage.setItem(LS_CUSTOM_URL, $('serverUrl').value);
        }
        localStorage.setItem(LS_LEGACY_SECRET, $('adminSecret').value);
        refreshSecretIndicator();
        setStatus('settings saved for ' + envLabel(), 'ok');
      };
      refreshSecretIndicator();
    }
```

This keeps the secret on the legacy key for one task only — Task 4 replaces both lines with the per-env map. Leaving it wired this way keeps the page fully working at the end of this task.

Also update `refreshSecretIndicator` and the `adminSecret()` reader to keep using `LS_LEGACY_SECRET` for now: change `localStorage.getItem(LS_SECRET)` → `localStorage.getItem(LS_LEGACY_SECRET)` in `refreshSecretIndicator`, and `localStorage.removeItem(LS_SECRET)` → `localStorage.removeItem(LS_LEGACY_SECRET)` in `adminFetch`.

- [ ] **Step 7: Call `bootEnv` first in the boot sequence**

Replace the `DOMContentLoaded` handler (lines 695-702) with:

```js
    document.addEventListener('DOMContentLoaded', () => {
      bootEnv();
      bootSettings();
      bootHeapsList();
      bootEditHeap();
      bootCreateHeap();
      bootRewardCodes();
      bootConfig();
      applyEnv(currentEnv());
    });
```

`applyEnv` runs last because it triggers the loads, and `bootHeapsList` / `bootRewardCodes` / `bootConfig` each also kick off their own initial load. Remove the now-duplicated initial calls: delete `loadHeaps();` from `bootHeapsList`, `loadCodes();` from `bootRewardCodes`, and `loadConfig();` from `bootConfig` — `applyEnv` performs all three.

- [ ] **Step 8: Verify in the browser**

1. Navigate to the file URL with a clean slate:

```js
localStorage.clear(); location.reload();
```

2. Expect the selector to read `Local`, the URL readout to show `http://localhost:8787`, and the heaps table to populate.
3. `browser_select_option` on `#envSelect` → `Production`. Expect the readout switches to the prod URL and the heaps table repopulates with production heaps.
4. Select `Custom…`. Expect the Custom Server URL input appears in Settings. Type `http://localhost:8787`, blur, and confirm the readout updates.
5. Reload the page. Expect it comes back on `Custom…` with the URL retained.
6. Select `Local`, click Edit on a heap so the edit panel opens, then switch to
   `Production`. Expect the panel to close — heap GUIDs do not cross
   environments, and a stale panel invites saving params against an ID the new
   server has never seen. Confirm with:

```js
({ display: document.getElementById('editPanel').style.display })
```

Expected: `{ display: 'none' }`.

7. Confirm exactly one network round of loads per switch (no double-fetch from the removed duplicate calls):

```js
performance.getEntriesByType('resource').filter(r => r.name.includes('/heaps')).length
```

Expected: `1` immediately after a fresh load.

- [ ] **Step 9: Commit**

```bash
git add admin/index.html
git commit -m "feat(admin): environment dropdown with custom URL fallback"
```

---

### Task 4: Per-env secrets, legacy migration, eye toggle

**Files:**
- Modify: `admin/index.html` — `adminSecret()`, `refreshSecretIndicator()`, `adminFetch()` 401 branch, `bootSettings()`, `applyEnv()`, Settings card markup.

**Interfaces:**
- Consumes: `ENVS`, `currentEnv()`, `stripSlash()`, `envLabel()`, `applyEnv()`, `LS_SECRETS`, `LS_CUSTOM_URL`, `LS_LEGACY_URL`, `LS_LEGACY_SECRET`.
- Produces: `readSecrets(): Record<string,string>`, `writeSecret(env, secret): void` (empty/falsy secret deletes the entry), `migrateLegacySettings(): void`.

- [ ] **Step 1: Add the secrets map helpers**

Add to the Environment section, below `envLabel`:

```js
    // Secrets are per-environment: staging and production each have their own
    // ADMIN_SECRET, so one shared value would 401 on every switch.
    function readSecrets() {
      try {
        const raw = JSON.parse(localStorage.getItem(LS_SECRETS) || '{}');
        return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
      } catch (e) {
        return {};
      }
    }

    function writeSecret(env, secret) {
      const all = readSecrets();
      if (secret) all[env] = secret; else delete all[env];
      localStorage.setItem(LS_SECRETS, JSON.stringify(all));
    }
```

A corrupted `heapAdmin.secrets` value degrades to "no secret saved" rather than throwing during boot.

- [ ] **Step 2: Add the one-time legacy migration**

Add below `writeSecret`:

```js
    // One-time move from the pre-multi-env keys. Idempotent: once the legacy
    // keys are gone this returns immediately.
    function migrateLegacySettings() {
      const legacyUrl    = localStorage.getItem(LS_LEGACY_URL);
      const legacySecret = localStorage.getItem(LS_LEGACY_SECRET);
      if (legacyUrl === null && legacySecret === null) return;

      const url = stripSlash(legacyUrl || ENVS.local.url);
      let env = Object.keys(ENVS)
        .find(k => ENVS[k].url && stripSlash(ENVS[k].url) === url);
      if (!env) {
        env = 'custom';
        localStorage.setItem(LS_CUSTOM_URL, url);
      }
      localStorage.setItem(LS_ENV, env);
      if (legacySecret) writeSecret(env, legacySecret);

      localStorage.removeItem(LS_LEGACY_URL);
      localStorage.removeItem(LS_LEGACY_SECRET);
    }
```

- [ ] **Step 3: Run the migration before anything reads storage**

In the `DOMContentLoaded` handler, make `migrateLegacySettings()` the first statement, above `bootEnv()`.

- [ ] **Step 4: Swap the secret reads and writes onto the map**

`refreshSecretIndicator`:

```js
    function refreshSecretIndicator() {
      const has = !!readSecrets()[currentEnv()];
      $('secretDot').className = 'dot' + (has ? ' dot-ok' : '');
      $('secretLabel').textContent = has
        ? 'secret saved for ' + envLabel()
        : 'no secret saved for ' + envLabel();
    }
```

`bootSettings` — replace the temporary legacy wiring from Task 3:

```js
    function bootSettings() {
      $('saveSettings').onclick = () => {
        if (currentEnv() === 'custom') {
          localStorage.setItem(LS_CUSTOM_URL, $('serverUrl').value);
        }
        writeSecret(currentEnv(), $('adminSecret').value);
        refreshSecretIndicator();
        setStatus('settings saved for ' + envLabel(), 'ok');
      };
      $('secretEye').onclick = toggleSecretVisibility;
      refreshSecretIndicator();
    }
```

`adminFetch`'s 401 branch — clear only this environment:

```js
      if (res.status === 401) {
        writeSecret(currentEnv(), '');
        refreshSecretIndicator();
        throw new Error('admin secret rejected for ' + envLabel() + ' — cleared from localStorage');
      }
```

- [ ] **Step 5: Load the env's secret on switch**

In `applyEnv`, add these two lines directly after the `customUrlWrap` / `serverUrl` handling and before `$('envUrl')`:

```js
      $('adminSecret').value = readSecrets()[env] || '';
      $('adminSecret').type = 'password';
      refreshSecretIndicator();
```

Resetting `type` to `password` means a revealed secret does not stay revealed across an environment switch.

- [ ] **Step 6: Add the eye button markup**

Replace the Admin Secret label + input in the Settings card with:

```html
    <label class="lbl mt-3">Admin Secret <span class="muted">(stored per environment)</span></label>
    <div class="relative">
      <input type="password" id="adminSecret" class="field pr-9" placeholder="leave blank if server has no secret" />
      <button type="button" id="secretEye" title="Show/hide secret"
              class="absolute right-1 top-1/2 -translate-y-1/2 cursor-pointer bg-transparent p-1 text-term-dim hover:text-term-green">
        <svg id="eyeOpen" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
             fill="none" stroke="currentColor" stroke-width="2">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
        </svg>
        <svg id="eyeClosed" style="display:none" xmlns="http://www.w3.org/2000/svg" width="16" height="16"
             viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
      </button>
    </div>
```

Inline SVG keeps the file dependency-free.

- [ ] **Step 7: Add the toggle handler**

Add to the Settings section of the script, above `bootSettings`:

```js
    function toggleSecretVisibility() {
      const input = $('adminSecret');
      const shown = input.type === 'text';
      input.type = shown ? 'password' : 'text';
      $('eyeOpen').style.display   = shown ? '' : 'none';
      $('eyeClosed').style.display = shown ? 'none' : '';
    }
```

- [ ] **Step 8: Verify the migration in the browser**

Seed the old-format keys, reload, and inspect:

```js
localStorage.clear();
localStorage.setItem('heapAdmin.serverUrl', 'https://heap-server.hanlinsoftwaresws.workers.dev');
localStorage.setItem('heapAdmin.adminSecret', 'legacy-value');
location.reload();
```

Then run:

```js
({
  env: localStorage.getItem('heapAdmin.env'),
  secrets: localStorage.getItem('heapAdmin.secrets'),
  legacyUrl: localStorage.getItem('heapAdmin.serverUrl'),
  legacySecret: localStorage.getItem('heapAdmin.adminSecret'),
})
```

Expected exactly:

```json
{ "env": "prod", "secrets": "{\"prod\":\"legacy-value\"}", "legacyUrl": null, "legacySecret": null }
```

Repeat with an unrecognized URL (`https://example.com/api`) and expect `env: "custom"` plus `heapAdmin.customUrl` set to that URL.

- [ ] **Step 9: Verify per-env secrets and the eye**

1. On `Local`, type `secret-local`, Save Settings. Expect status `settings saved for Local` and a green dot.
2. Switch to `Staging`, type `secret-staging`, Save Settings.
3. Switch back to `Local`. Expect the field repopulates with `secret-local`, masked.
4. Confirm both are stored side by side:

```js
JSON.parse(localStorage.getItem('heapAdmin.secrets'))
```

Expected: `{ local: 'secret-local', staging: 'secret-staging' }`.

5. Click the eye. Expect the value becomes readable and the icon swaps to the crossed-out eye; click again to re-mask.
6. Switch environments while revealed — expect the field comes back masked.

- [ ] **Step 10: Commit**

```bash
git add admin/index.html
git commit -m "feat(admin): per-environment admin secrets with eye toggle"
```

---

### Task 5: Reachability dot, PROD guard, and wrap-up

**Files:**
- Modify: `admin/index.html` — `loadHeaps()`, `applyEnv()`, header markup, `onDeleteHeap()`, `onDeleteConfigKey()`.
- Modify: `Todo/Todo.md` — mark the admin QoL line done.

**Interfaces:**
- Consumes: everything from Tasks 3-4.
- Produces: `setEnvHealth(ok): void`, `refreshProdBadge(): void`.

- [ ] **Step 1: Add the health and badge helpers**

Add to the Environment section:

```js
    function setEnvHealth(ok) {
      $('envDot').className = 'dot' + (ok ? ' dot-ok' : '');
      $('envDot').title = ok ? 'last request succeeded' : 'last request failed';
    }

    function refreshProdBadge() {
      const isProd = currentEnv() === 'prod';
      $('prodBadge').style.display = isProd ? '' : 'none';
      $('appHeader').classList.toggle('border-term-red', isProd);
      $('appHeader').classList.toggle('border-term-line', !isProd);
    }
```

- [ ] **Step 2: Add the badge to the header and an id to `<header>`**

Give the header element `id="appHeader"` and insert the badge after the `<h1>`:

```html
  <header id="appHeader" class="sticky top-0 z-20 -mx-4 mb-4 border-b border-term-line bg-term-bg/95 px-4 py-3 backdrop-blur">
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-lg font-bold tracking-widest text-term-green">HEAP ADMIN</h1>
      <span id="prodBadge" class="badge border-term-red font-bold text-term-red" style="display:none">PROD</span>
```

- [ ] **Step 3: Drive the dot from `loadHeaps`**

`loadHeaps` already has the success and failure paths; set health in both:

```js
    async function loadHeaps() {
      try {
        const res = await fetch(serverUrl() + '/heaps');
        if (!res.ok) throw new Error('list failed: ' + res.status);
        const data = await res.json();
        cachedHeaps = data.heaps || [];
        renderHeapsTable();
        setEnvHealth(true);
      } catch (e) {
        setEnvHealth(false);
        setStatus(String(e), 'err');
      }
    }
```

No extra request is made — this rides on a load the page already performs.

- [ ] **Step 4: Call `refreshProdBadge` on switch**

Add `refreshProdBadge();` to `applyEnv`, immediately after `refreshSecretIndicator();`.

- [ ] **Step 5: Name the environment in destructive confirms**

`onDeleteHeap`:

```js
      if (!confirm(`Delete "${heap.params.name}" on ${envLabel()}? This cannot be undone.`)) return;
```

`onDeleteConfigKey`:

```js
      if (!confirm('Delete config key "' + key + '" on ' + envLabel() + '? This cannot be undone.')) return;
```

- [ ] **Step 6: Verify in the browser**

1. On `Local` with the worker running: dot green, no PROD badge, header border grey.
2. Stop the local worker and click Refresh. Expect dot red and an error in the status bar; the page stays usable.
3. Switch to `Production`. Expect the PROD badge appears, the header border turns red, and the dot goes green (prod is reachable).
4. Click a heap's `×` on production and read the dialog — it must name `Production`. **Cancel it.**
5. Switch back to `Local`. Expect the badge disappears and the border returns to grey.
6. `browser_take_screenshot` on both Local and Production for the PR description.

- [ ] **Step 7: Regression check**

```bash
npm run build && npm test
```

Expected: both pass. Neither touches `admin/index.html`; this only confirms nothing else drifted.

- [ ] **Step 8: Update Todo.md**

In `Todo/Todo.md`, replace the line

```
Improve Admin UI - add drop down to switch ENVS + add envs, Saves Admin Secret Admin secret can be displayed with a Eye button in the text box.
```

with

```
~~Improve Admin UI - env dropdown, per-env admin secrets, eye toggle~~ — done 2026-07-28, Tailwind restyle in the same pass.
```

Leave the heap-silhouette line below it untouched — that work is still outstanding.

- [ ] **Step 9: Commit and open the PR**

```bash
git add admin/index.html Todo/Todo.md
git commit -m "feat(admin): env reachability dot and production guard rails"
git push -u origin feature/admin-ui-tailwind
gh pr create --title "feat(admin): Tailwind restyle + environment switcher" --body "$(cat <<'EOF'
Restyles `admin/index.html` onto Tailwind (v4 browser CDN, no build step — the
file stays standalone) and replaces the free-text server URL with an
environment dropdown.

- Env dropdown: Local / Staging / Production / Custom…
- **Per-environment admin secrets** — staging and prod have different
  `ADMIN_SECRET`s, so a single shared value 401'd on every switch. Old
  `heapAdmin.serverUrl` / `heapAdmin.adminSecret` keys migrate once, then are
  removed.
- Eye toggle reveals the secret; re-masks on env switch.
- Reachability dot off the existing heaps load; PROD badge, red header, and the
  environment named in destructive confirms.
- Status moved to a sticky bottom bar — on a page this tall, save results
  rendered below the fold were invisible.

Spec: `docs/superpowers/specs/2026-07-28-admin-ui-tailwind-design.md`
Plan: `docs/superpowers/plans/2026-07-28-admin-ui-tailwind.md`

Verified manually against a local `wrangler dev` and production; `npm run build`
and `npm test` pass.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Out of scope

The heap-silhouette band viewer (`Todo/Todo.md`, line below the admin QoL item) needs a new admin server route and gets its own spec. Do not start it here.
