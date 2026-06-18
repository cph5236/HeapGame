# Feedback Button — Design

**Date:** 2026-06-18
**Branch:** `feature/feedback-button`
**Status:** Approved, pending implementation plan

## Summary

Add a low-friction in-game feedback channel. Players tap a **"🐛 Bug"** button on
the main menu, type a free-text message, and send it. Submissions land in a new D1
`feedback` table with auto-attached context (player GUID, app version, platform,
heap, user agent). Claude reads the feedback remotely via a GitHub Action that
calls an admin-gated `GET /feedback` endpoint, so the admin secret never enters
Claude's conversation context — it lives only in the GitHub secret store.

## Decisions (from brainstorming)

1. **Form content:** single free-text message + auto-attached metadata. No category,
   no contact field. Lowest friction.
2. **Read mechanism:** admin-gated `GET /feedback` HTTP endpoint, invoked by Claude
   through a GitHub Action (`workflow_dispatch`). Chosen for portability — Claude can
   fetch feedback from any machine, not just the local dev box.
3. **Secret handling:** the admin secret is a GitHub repo secret injected only inside
   the runner. Claude never sees it. The response is uploaded as a build artifact and
   downloaded with `gh run download`.
4. **De-duplication over time:** timestamp cursor. `GET /feedback?since=<ISO>` returns
   only rows newer than the cursor. No `handled` column, no write-back endpoint. The
   `created_at` column exists regardless, so this needs no extra schema beyond an index.

## 1. Data layer (D1)

New migration `server/migrations/0009_feedback_table.sql`, with `server/schema.sql`
updated to the final state (per project D1 convention — never edit an applied
migration; one migration per change).

```sql
CREATE TABLE feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  player_guid TEXT    NOT NULL,
  message     TEXT    NOT NULL,
  app_version TEXT    NOT NULL DEFAULT '',
  platform    TEXT    NOT NULL DEFAULT '',
  heap_id     TEXT,                 -- nullable: from the menu there may be no active heap
  user_agent  TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL      -- ISO8601, server-stamped
);
CREATE INDEX idx_feedback_created_at ON feedback(created_at);
```

The `created_at` index keeps the `since` cursor query cheap as volume grows.

New `server/src/feedbackDb.ts` exposes a `FeedbackDB` interface, mirroring the
structure of `codeDb.ts`:

```ts
export interface NormalizedFeedback {
  playerGuid: string;
  message:    string;
  appVersion: string;
  platform:   string;
  heapId:     string | null;
  userAgent:  string;
}

export interface FeedbackDB {
  /** Insert one feedback row. created_at is server-stamped (ISO8601). */
  insert(f: NormalizedFeedback, now: string): Promise<void>;
  /** Rows with created_at > since (or all if since is null), newest first. */
  listSince(since: string | null): Promise<FeedbackRow[]>;
}
```

- `D1FeedbackDB` — production impl backed by the `DB` binding.
- `MockFeedbackDB` — in-memory impl for tests.

Shared row/request types go in `shared/feedbackTypes.ts` (`FeedbackRow`,
`FeedbackSubmitRequest`).

## 2. Server routes (`server/src/routes/feedback.ts`)

Follows the defensive style of `routes/log.ts` and the admin-gate pattern of
`routes/codes.ts`.

### `POST /feedback` — public, rate-limited

- Wired through a new `RL_FEEDBACK` rate-limit bucket (`namespace_id = 1006`,
  next free after `RL_CODES` = 1005) added to `server/wrangler.toml` and the
  `limiters.feedback` slot in `AppOptions`.
- Validation (cheap-to-expensive ordering, mirroring `log.ts`):
  - Reject bodies over a max byte size via `content-length` before parsing.
  - Reject non-object body or missing/empty `message`.
  - Clamp `message` to ~2 KB; coerce metadata fields to bounded strings.
  - **Ignore any client-supplied timestamp** — the server stamps `created_at`.
- On success: insert and return `204`. Sink/DB errors are swallowed so abuse or
  outages don't surface to clients (same posture as `/log`).

### `GET /feedback?since=<ISO>` — admin-gated

- Behind the existing `requireAdminSecret` middleware (`X-Admin-Secret` header).
- Parses optional `since` query param. Invalid/absent ⇒ return all.
- Returns `FeedbackRow[]` newest-first as JSON.
- `401` when the secret is missing or wrong.

### Wiring

- `app.ts`: add `feedbackDb?: FeedbackDB` and `limiters.feedback?` to `AppOptions`;
  mount `feedbackRoutes` (mount `GET` behind the admin gate, `POST` behind the
  rate limiter). Only mount when `feedbackDb` is provided (same optional pattern
  as `codeDb` / `logSink`).
- `index.ts`: construct `D1FeedbackDB(env.DB)` and pass it through, plus the
  `RL_FEEDBACK` limiter binding.

## 3. Client UI (`src/scenes/MenuScene.ts` + new overlay)

- A small **"🐛 Bug"** button pinned **top-right** of the main menu. Plain text +
  emoji for v1 — no new art. (Restyle later.)
- Tapping opens a lightweight `FeedbackOverlay` (new file under `src/scenes/` or
  `src/ui/`, matching where the existing keyboard-modal lives):
  - Title, a multi-line text input (reusing the existing keyboard-modal input
    pattern already used for the name editor / reward-code entry), a **Send**
    button, and a **Cancel / X**.
- On **Send**:
  - POST to `${VITE_HEAP_SERVER_URL}/feedback` with `{ message }` plus the
    metadata envelope from `getEnvelope()` (`src/logging/index.ts`) — reuse it
    rather than re-deriving GUID/version/platform — and the current heap id if
    one is active.
  - Show a brief "Thanks!" confirmation toast, then close.
  - On failure: fail quietly with a non-blocking "Couldn't send — try again"
    message. Never block the menu.

## 4. Read path (GitHub Action)

New `.github/workflows/fetch-feedback.yml`:

- Trigger: `workflow_dispatch` with an optional `since` input (ISO date string).
- Step: curl `GET ${{ secrets.VITE_HEAP_SERVER_URL }}/feedback?since=<input>` with
  header `X-Admin-Secret: ${{ secrets.ADMIN_SECRET }}` (reuse the existing
  `VITE_HEAP_SERVER_URL` repo secret for the base URL).
- Write the JSON response to `feedback.json`.
- Upload `feedback.json` as a build artifact (`actions/upload-artifact`).

Claude reads it remotely:
```
gh workflow run fetch-feedback.yml -f since=<ISO>   # optional
gh run download <run-id> -n feedback                 # pulls feedback.json
```

**New repo secret required:** `ADMIN_SECRET` (matching the worker's configured
admin secret). The secret is injected only inside the runner and never appears in
Claude's context; the feedback JSON itself is not sensitive.

## 5. Testing

- **Server (Vitest):**
  - `feedbackDb` — `insert` then `listSince` returns rows newest-first; `since`
    filters correctly; null `since` returns all.
  - `POST /feedback` — empty message rejected; oversized body rejected; message
    clamped; metadata coerced; client timestamp ignored; happy path inserts +
    returns 204.
  - `GET /feedback` — `401` without the admin secret; with the secret, returns
    rows; `since` filtering honored.
- **Client (Vitest):**
  - `FeedbackOverlay` builds the correct POST payload (message + envelope + heap id).
  - Failure path surfaces the "couldn't send" message and does not throw.

## Out of scope (v1)

- Categories / triage tags, contact field, attachments/screenshots.
- A `handled` flag or write-back endpoint (timestamp cursor covers de-dup).
- An in-app admin UI for reading feedback (the `GET` endpoint future-proofs this).
- Custom art for the button.

## Conventions to honor during implementation

- Run `npm run build` before claiming done (catches TS errors tests miss).
- Migration file + `schema.sql` update together; apply with
  `cd server && npx wrangler d1 migrations apply heap-db --local` (and `--remote`
  for production).
- Don't commit `.wrangler/state/`.
