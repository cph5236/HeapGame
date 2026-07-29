# Admin UI — Tailwind Restyle + Environment Switcher — Design

**Origin:** `Todo/Todo.md` § FEATURES — "Improve Admin UI - add drop down to
switch ENVS + add envs, Saves Admin Secret. Admin secret can be displayed with
an Eye button in the text box." Brainstormed 2026-07-28.

Scope is that Todo line plus a visual restyle. The heap-silhouette band viewer
on the following Todo line is **explicitly out of scope** — it needs a new admin
server route and gets its own spec.

## Context

`admin/index.html` is a single 706-line standalone static file: inline `<style>`,
inline `<script>`, no imports, no bundler. It is not part of the Vite build and
no workflow deploys it — it is opened directly from disk by one operator. That
constraint drives every decision below: whatever we add must survive being
double-clicked from the filesystem, with no build step to forget.

Three server environments exist and all three respond (verified 2026-07-28,
`GET /heaps` → 200):

| Env | URL | Source |
|-----|-----|--------|
| Local | `http://localhost:8787` | `DEFAULT_URL` in the current file |
| Staging | `https://heap-server-staging.hanlinsoftwaresws.workers.dev` | `name = "heap-server-staging"`, `server/wrangler.toml:119` |
| Production | `https://heap-server.hanlinsoftwaresws.workers.dev` | `VITE_HEAP_SERVER_URL` in `.env` |

**Staging and production hold separate `ADMIN_SECRET` values** — each is set by
its own `wrangler secret put ADMIN_SECRET [--env staging]` (documented at
`server/wrangler.toml:111-112`). This is the fact that shapes part 1: a single
shared secret box would 401 on every environment switch.

## Goal

Three outcomes:

1. Switch environments from a dropdown instead of hand-editing a URL, with each
   environment remembering its own admin secret.
2. Reveal the admin secret with an eye toggle.
3. Restyle onto Tailwind so the page reads as a deliberate tool rather than an
   accreted form dump.

Non-goals: no change to any request path, payload, or response handling; no new
server routes; no admin auth changes.

## Part 1 — Environment switcher

### Presets and custom

A `<select id="envSelect">` in the header offers `Local` / `Staging` /
`Production` / `Custom…`. The three presets are a const table in the script,
matching the URLs above. Choosing `Custom…` reveals the existing Server URL
text input; choosing any preset hides it. Free-form URLs therefore remain
reachable — the dropdown adds a shortcut, it does not remove capability.

### Storage schema

Current keys are flat and single-valued:

```js
const LS_URL    = 'heapAdmin.serverUrl';
const LS_SECRET = 'heapAdmin.adminSecret';
```

They become:

| Key | Value |
|-----|-------|
| `heapAdmin.env` | `'local' \| 'staging' \| 'prod' \| 'custom'` |
| `heapAdmin.customUrl` | URL string, only meaningful when env is `custom` |
| `heapAdmin.secrets` | JSON object keyed by env id → secret string |

`heapAdmin.secrets` is read through a helper that tolerates absent or malformed
JSON by returning `{}`, so a corrupted value degrades to "no secret saved"
rather than throwing during boot.

### One-time migration

On boot, if `heapAdmin.adminSecret` or `heapAdmin.serverUrl` exists:

1. Match the saved URL against the preset table (after stripping any trailing
   slash) to pick an env id; no match → `custom`, and the URL is written to
   `heapAdmin.customUrl`.
2. Write the saved secret into `heapAdmin.secrets` under that id, and the id
   into `heapAdmin.env`.
3. Remove both old keys.

The migration is idempotent: once the old keys are gone it does not run again.

### Switching behavior

Selecting a different environment:

1. Persists the new env id.
2. Loads that env's secret into the secret input (blank if none saved).
3. Hides the edit panel and clears `editingHeapId` — heap GUIDs do not exist
   across environments, and leaving a stale panel open invites saving params
   against a heap ID the new server has never seen.
4. Re-runs `loadHeaps()`, `loadCodes()`, and `loadConfig()`.

### Reachability dot

The existing green/red dot pattern is reused next to the selector. `loadHeaps()`
sets it green on success and red on failure, so switching environments tells you
immediately whether that Worker is up. No separate ping button and no new
request: this rides on a load the page already performs.

### Production guard

When env is `prod` the header shows a red `PROD` badge and the header border
turns red. The two existing `confirm()` dialogs (delete heap, delete config key)
interpolate the current environment name into their message, so a destructive
click on production reads as such before it is confirmed.

### 401 handling

`adminFetch` currently does `localStorage.removeItem(LS_SECRET)` on a 401,
clearing the one global secret. It now clears **only the current env's entry**
in `heapAdmin.secrets`, leaving the other environments' saved secrets intact.

## Part 2 — Secret field

The secret input is wrapped in a relatively-positioned container with an eye
button pinned inside its right edge; clicking toggles the input's `type` between
`password` and `text` and swaps the icon. Icons are inline SVG — no icon-font or
image dependency, consistent with the file being standalone.

Saving stays explicit via Save Settings (writing to the current env's slot in
`heapAdmin.secrets`), and the saved/not-saved indicator becomes a badge reading
the current env's entry rather than the old global key.

## Part 3 — Tailwind restyle

### Loading Tailwind

A single `<script src="https://unpkg.com/@tailwindcss/browser@4"></script>` plus
an inline `<style type="text/tailwindcss">` block. No build step, no new
dependency in `package.json`, file stays standalone. Cost accepted: the page
needs network to style itself, and shows a brief unstyled flash on load. If the
CDN is unreachable the page still functions — every control works, it is merely
unstyled.

### Visual direction

The existing terminal identity is kept and sharpened, not replaced: monospace
throughout, black background, green primary accent. This also keeps the admin
surface visually unmistakable against the game's own UI.

The inline block carries an `@theme` defining the palette and mono font as
tokens, and an `@layer components` set — `.card`, `.card-head`, `.field`,
`.btn`, `.btn-danger`, `.btn-sm`, `.tbl`, `.badge`. Component classes rather
than raw utilities repeated across ~70 inputs: the markup stays readable and the
diff stays reviewable. Per-section left-border accent colors are preserved,
since they encode what each section does.

### Layout

- `max-w-5xl` centered column.
- Sticky header: title, env selector, reachability dot, PROD badge.
- Cards with uppercase headers replacing the current bare left-border divs.
- Form rows become `grid gap-3 md:grid-cols-2`, collapsing to one column on
  narrow windows (the current `.row` is a hard 2-column grid at every width).
- Tables get sticky headers, zebra rows, hover state, right-aligned actions.
- **Status moves from the page bottom to a sticky bottom bar.** On a page this
  tall, a save result rendered below the fold is invisible at the moment it
  matters.
- Clicking Edit scrolls the edit panel into view.

### Preserved exactly

All fetch logic and routes; `KINDS`, `FIELDS`, `KIND_DEFAULTS`, `ITEM_IDS`,
`INFINITE_HEAP_ID`; every `escapeHtml` call site; the inline `onclick` handler
pattern in generated table rows (`onEditHeap`, `onDeleteHeap`,
`onSaveConfigKey`, `onDeleteConfigKey` stay global functions).

## Testing

This page has no automated test coverage and this design does not add a test
framework for it — a standalone file with no module boundary offers nothing to
import. Verification is manual, against a running local Worker, plus Playwright
screenshots:

1. **Migration:** seed old-format `heapAdmin.serverUrl` +
   `heapAdmin.adminSecret` in localStorage, reload, assert the secret landed in
   the right env slot and the old keys are gone.
2. **Per-env secrets:** save distinct secrets on two envs, switch back and
   forth, assert each input repopulates with its own value.
3. **Env switch:** switch to local with a Worker running → heaps table
   populates, dot green. Switch to an env with nothing listening → dot red,
   status shows the error, page does not wedge.
4. **Eye toggle:** reveals and re-hides.
5. **Edit panel:** open a heap, switch env, assert the panel closed.
6. **Layout:** screenshots at desktop and ~500 px wide; no horizontal scroll.
7. `npm run build` and `npm test` still pass (neither touches this file, so this
   is a regression check only).

## Risks

- **CDN dependency.** Offline → unstyled page. Accepted; functionality is
  unaffected and this is a single-operator internal tool.
- **Play CDN is not intended for production traffic.** Irrelevant here: the file
  is never deployed or served to users.
- **localStorage migration is one-way.** Reverting the file would leave the new
  keys unread and the operator re-entering secrets once. Low cost, and the old
  keys are only removed after the new ones are written.
