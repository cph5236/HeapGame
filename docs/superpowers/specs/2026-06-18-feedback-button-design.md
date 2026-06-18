# Feedback Button — Design

**Date:** 2026-06-18
**Branch:** `feature/feedback-button`
**Status:** Approved, pending implementation plan
**Revision:** 2 (addresses review: category choice, explicit validation,
monotonic cursor, artifact-name match, public envelope accessor + sessionId,
concrete rate-limit values)

## Summary

Add a low-friction in-game feedback channel. Players tap a **"🐛 Bug"** button on
the main menu, which opens a popup modal where they pick a category
(**Bug** or **Feedback/Suggestion**), type a free-text message, and submit.
Submissions land in a new D1 `feedback` table with auto-attached context
(player GUID, session id, app version, platform, heap, user agent). Claude reads
the feedback remotely via a GitHub Action that calls an admin-gated
`GET /feedback` endpoint, so the admin secret never enters Claude's conversation
context — it lives only in the GitHub secret store.

## Decisions (from brainstorming + review)

1. **Form content:** a category choice (**Bug** | **Feedback/Suggestion**) plus a
   single free-text message, plus auto-attached metadata. No contact field.
2. **Read mechanism:** admin-gated `GET /feedback` HTTP endpoint, invoked by Claude
   through a GitHub Action (`workflow_dispatch`). Chosen for portability — Claude can
   fetch feedback from any machine, not just the local dev box.
3. **Secret handling:** the admin secret is a GitHub repo secret injected only inside
   the runner. Claude never sees it. The response is uploaded as a build artifact and
   downloaded with `gh run download`.
4. **De-duplication over time:** **monotonic `id` cursor.** `GET /feedback?since_id=<int>`
   returns only rows with `id > since_id`. Because `id` is `AUTOINCREMENT`, two
   submissions sharing the same `created_at` can never collide or be skipped (the
   tie problem with a `created_at`-only cursor). `created_at` is still stored and
   returned for human readability, but is **not** the cursor.

## 1. Data layer (D1)

New migration `server/migrations/0009_feedback_table.sql`, with `server/schema.sql`
updated to the final state (per project D1 convention — never edit an applied
migration; one migration per change).

```sql
CREATE TABLE feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category    TEXT    NOT NULL,         -- 'bug' | 'suggestion'
  player_guid TEXT    NOT NULL,
  session_id  TEXT    NOT NULL DEFAULT '',  -- correlate with that session's logs
  message     TEXT    NOT NULL,
  app_version TEXT    NOT NULL DEFAULT '',
  platform    TEXT    NOT NULL DEFAULT '',
  heap_id     TEXT,                      -- nullable: from the menu there is usually no active heap
  user_agent  TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL           -- ISO8601, server-stamped
);
```

No extra index is needed: the `id` primary key already gives an indexed, monotonic
cursor for `WHERE id > ?`.

New `server/src/feedbackDb.ts` exposes a `FeedbackDB` interface, mirroring the
structure of `codeDb.ts`:

```ts
export type FeedbackCategory = 'bug' | 'suggestion';

export interface NormalizedFeedback {
  category:   FeedbackCategory;
  playerGuid: string;
  sessionId:  string;
  message:    string;
  appVersion: string;
  platform:   string;
  heapId:     string | null;
  userAgent:  string;
}

export interface FeedbackDB {
  /** Insert one feedback row. created_at is server-stamped (ISO8601). */
  insert(f: NormalizedFeedback, now: string): Promise<void>;
  /** Rows with id > sinceId (or all if sinceId is null), ordered by id ASC. */
  listSince(sinceId: number | null): Promise<FeedbackRow[]>;
}
```

- `D1FeedbackDB` — production impl backed by the `DB` binding.
- `MockFeedbackDB` — in-memory impl for tests.

Shared types go in `shared/feedbackTypes.ts`:
- `FeedbackCategory = 'bug' | 'suggestion'`
- `FeedbackRow` — full row shape (includes `id`, all columns).
- `FeedbackSubmitRequest` — the client → server POST body (see §3).

## 2. Server routes (`server/src/routes/feedback.ts`)

Follows the defensive style of `routes/log.ts` and the admin-gate pattern of
`routes/codes.ts`.

### `POST /feedback` — public, rate-limited

- Wired through a new `RL_FEEDBACK` rate-limit bucket (see §6).
- Validation (cheap-to-expensive ordering, mirroring `log.ts`):
  - Reject bodies over a max byte size via `content-length` before parsing.
  - Reject non-object body.
  - **`category`** must be exactly `'bug'` or `'suggestion'`; otherwise `400`.
  - **`message`** must be a non-empty string after trimming; otherwise `400`.
  - **`message`** is hard-capped at **3,000 characters** server-side: reject with
    `400` if longer (the client also enforces this — see §3 — so a >3,000 body is
    treated as malformed rather than silently truncated).
  - Coerce metadata fields (`playerGuid`, `sessionId`, `appVersion`, `platform`,
    `heapId`, `userAgent`) to bounded strings; `heapId` may be null/absent.
  - **Ignore any client-supplied timestamp/id** — the server stamps `created_at`,
    D1 assigns `id`.
- On success: insert and return `204`. DB errors are swallowed so abuse or outages
  don't surface to clients (same posture as `/log`).

### `GET /feedback?since_id=<int>` — admin-gated

- Behind the existing `requireAdminSecret` middleware (`X-Admin-Secret` header).
- Parses optional `since_id` query param (integer). Invalid/absent ⇒ return all.
- Returns `FeedbackRow[]` ordered by `id` ASC as JSON (ascending so the caller can
  take the last row's `id` as the next cursor).
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
- Tapping opens a **popup modal** `FeedbackOverlay` (new file, alongside the
  existing keyboard-modal used for the name editor / reward-code entry):
  - **Category selector** — a two-option toggle: **Bug** | **Feedback/Suggestion**.
    Defaults to **Bug** (the button is labelled "Bug").
  - **Multiline text area** — reuses the existing keyboard-modal input pattern.
    Hard-limits input to **3,000 characters** (the field cannot accept more).
  - **Submit** button — **disabled while the trimmed message is empty.**
  - **Cancel / X** to dismiss.
- On **Submit** (only reachable with a non-empty message):
  - POST `${VITE_HEAP_SERVER_URL}/feedback` with this body
    (`FeedbackSubmitRequest`):
    ```ts
    {
      category: 'bug' | 'suggestion',
      message: string,            // trimmed, ≤ 3000 chars
      // metadata from getLogEnvelope() (see below):
      playerGuid: string,
      sessionId: string,          // INCLUDED — ties feedback to that session's logs
      appVersion: string,
      platform: string,
      userAgent: string,
      // context:
      heapId: string | null       // current heap if one is active, else null
    }
    ```
  - **Envelope accessor:** `getEnvelope()` in `src/logging/index.ts` is currently a
    private function. Export a public `getLogEnvelope(): LogEnvelope` accessor
    (a thin wrapper over the existing internal one) and use it here, so the client
    payload is built from the same source of truth as logging (`userGuid`,
    `sessionId`, `appVersion`, `platform`, `userAgent`). `sessionId` **is** part of
    the feedback payload.
  - Show a brief "Thanks!" confirmation toast, then close.
  - On failure: fail quietly with a non-blocking "Couldn't send — try again"
    message. Never block the menu.

## 4. Read path (GitHub Action)

New `.github/workflows/fetch-feedback.yml`:

- Trigger: `workflow_dispatch` with an optional `since_id` input (integer string).
- Step: curl `GET ${{ secrets.VITE_HEAP_SERVER_URL }}/feedback?since_id=<input>`
  with header `X-Admin-Secret: ${{ secrets.ADMIN_SECRET }}` (reuse the existing
  `VITE_HEAP_SERVER_URL` repo secret for the base URL).
- Write the JSON response to `feedback.json`.
- Upload it with `actions/upload-artifact` using artifact **name `feedback`**
  (path `feedback.json`).

Claude reads it remotely (artifact name matches the download flag):
```
gh workflow run fetch-feedback.yml -f since_id=<int>   # since_id optional
gh run download <run-id> -n feedback                    # pulls feedback.json
```

**New repo secret required:** `ADMIN_SECRET` (matching the worker's configured
admin secret). The secret is injected only inside the runner and never appears in
Claude's context; the feedback JSON itself is not sensitive.

## 5. Rate limiting (`server/wrangler.toml`)

Add a new bucket after `RL_CODES`, matching the existing `[[ratelimits]]` format
(all current buckets use `period = 60`):

```toml
[[ratelimits]]
name = "RL_FEEDBACK"
namespace_id = "1006"
  [ratelimits.simple]
  limit = 5
  period = 60
```

`5` submissions per 60 s per IP — generous for a human typing feedback,
abuse-resistant. Mirrors the strict end of the existing buckets (`RL_CODES = 10`).

## 6. Testing

- **Server (Vitest):**
  - `feedbackDb` — `insert` then `listSince(null)` returns all ordered by id;
    `listSince(n)` returns only `id > n`; ordering is ascending.
  - `POST /feedback` — invalid/missing `category` → 400; empty/whitespace `message`
    → 400; `message` > 3000 chars → 400; metadata coerced; client-supplied
    `id`/timestamp ignored; happy path (both categories) inserts + returns 204.
  - `GET /feedback` — `401` without the admin secret; with the secret returns rows;
    `since_id` filtering returns only newer ids in ascending order.
- **Client (Vitest):**
  - `FeedbackOverlay` builds the correct POST payload for each category (message +
    full envelope incl. `sessionId` + `heapId`).
  - Submit is disabled when the message is empty/whitespace.
  - Failure path surfaces the "couldn't send" message and does not throw.

## Out of scope (v1)

- A third+ category, contact field, attachments/screenshots.
- A `handled` flag or write-back endpoint (the monotonic cursor covers de-dup).
- An in-app admin UI for reading feedback (the `GET` endpoint future-proofs this).
- Custom art for the button.

## Conventions to honor during implementation

- Run `npm run build` before claiming done (catches TS errors tests miss).
- Migration file + `schema.sql` update together; apply with
  `cd server && npx wrangler d1 migrations apply heap-db --local` (and `--remote`
  for production).
- Don't commit `.wrangler/state/`.
