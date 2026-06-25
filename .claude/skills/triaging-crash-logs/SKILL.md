---
name: triaging-crash-logs
description: Use when asked to retrieve, review, triage, or action HeapGame crash/error logs — the error-level entries captured automatically by the game and stored in the Analytics Engine `heap_logs` dataset, retrieved via the fetch-logs GitHub Action — into Crash_Reports.md.
---

# Triaging Crash Logs

The game auto-captures uncaught errors and unhandled rejections (see
`src/logging/capture.ts`) and ships them to the worker's `/log` endpoint. In
**production** those entries are written to the Cloudflare **Analytics Engine**
dataset `heap_logs`, *not* D1 (`server/src/index.ts` picks `AnalyticsEngineSink`
whenever `env.LOGS` is bound, which it is in `server/wrangler.toml`). This skill
pulls the unseen error logs via the `fetch-logs` GitHub Action, groups them by
error signature, and files the keepers into `Todo/Crash_Reports.md` in a single PR.

This is the logs counterpart to `triaging-player-feedback`. The big difference:
crash logs have **no monotonic id** — Analytics Engine is time-series — so the
cursor is a **server timestamp**, not an id.

**Core principle:** every run is incremental and idempotent — driven by a
committed **timestamp cursor** plus **signature-based dedup** — so the same crash
is never filed twice and nothing is skipped.

## Canonical paths — never invent your own

These are fixed. Reusing the same paths every run is what makes dedup work.

| Purpose | Path |
|---|---|
| Crash reports (you write) | `Todo/Crash_Reports.md` |
| Timestamp cursor (state) | `Todo/crash-log-cursor.json` → `{ "lastProcessedTs": "<UTC YYYY-MM-DD HH:MM:SS>" }` |

If a file does not exist yet, create it. A fresh cursor should start empty
(`{ "lastProcessedTs": "" }`) so the first run uses the Action's `hours` window.

## Security posture — you never see the API token

The AE SQL API is called with `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`,
GitHub repo secrets injected **only** inside the Action runner. They must never
enter your context. You read logs solely through the Action's uploaded artifact.
Never call the SQL API yourself, never ask for the token.

## Workflow

### 1. Read the cursor

```bash
CURSOR=$(jq -r '.lastProcessedTs // ""' Todo/crash-log-cursor.json 2>/dev/null || echo "")
echo "Last processed server_ts: ${CURSOR:-<none, will use hours window>}"
```

### 2. Run the Action and download the artifact

`gh workflow run` does not return the run id, and a fresh run takes a moment to
appear. Record the newest run id *before* dispatching, then poll until a
different one appears (watching the wrong run corrupts the cursor):

```bash
PREV=$(gh run list --workflow=fetch-logs.yml --limit 1 --json databaseId --jq '.[0].databaseId // 0')
# Pass the cursor as `since` when we have one; otherwise the Action's default
# `hours` window applies. level=error keeps triage focused on crashes.
gh workflow run fetch-logs.yml -f level=error ${CURSOR:+-f since="$CURSOR"}
RUN_ID="$PREV"
for _ in $(seq 1 30); do
  RUN_ID=$(gh run list --workflow=fetch-logs.yml --limit 1 --json databaseId --jq '.[0].databaseId // 0')
  [ "$RUN_ID" != "$PREV" ] && break
  sleep 2
done
gh run watch "$RUN_ID" --exit-status          # blocks until done; nonzero on failure
rm -f logs.json
gh run download "$RUN_ID" -n logs              # writes ./logs.json (artifact name: logs)
jq 'type=="array" and length' logs.json        # must print a number; errors if missing/corrupt
```

Rows are objects ordered by `server_ts` **descending** (newest first), each with:
`server_ts`, `user_guid`, `level`, `event` (the error message), `platform`,
`app_version`, `session_id`, `payload` (JSON string — holds `stack`, `filename`,
`lineno`/`colno` for window errors, or `url`/`status` for fetch errors),
`user_agent`, `client_ts` (ms).

**Investigating one specific report?** Skip the cursor and target it directly,
e.g. `-f user_guid=<guid>` (the reporter's id), `-f platform=mobile` (android+ios;
also `web`/`android`/`ios`), and/or a tight `-f since="YYYY-MM-DD HH:MM:SS"`
window — for "today", pass midnight UTC. Don't advance the cursor on an ad-hoc
investigation run — only the incremental triage run (step 5) moves it.

**If `gh run watch` fails or `length` is 0 unexpectedly:** the cause is almost
always a precondition, not your command. Surface it; do not try to fix by
obtaining the token. Likely causes:
- repo secret `CLOUDFLARE_API_TOKEN` lacks the **Account Analytics: Read**
  permission (the run log prints this hint on a 401/403), or `CLOUDFLARE_ACCOUNT_ID` unset
- the time window genuinely contains no errors

**If 0 rows:** nothing new — stop, do not open an empty PR. Report "no new crash
logs since `<cursor>`."

### 3. Triage — group by signature, don't transcribe

Crash logs are machine-captured, so the work is **clustering**, not classifying.

- **Compute a signature** per row: the error `event` (message) plus the top
  meaningful frame of `payload.stack` (and `filename:lineno` when present).
  Strip volatile bits (URLs with query strings, GUIDs, numbers in messages) so
  the same bug clusters even across sessions.
- **Merge by signature.** All rows sharing a signature become **one** entry that
  records the count of occurrences, distinct `user_guid`s, distinct
  `session_id`s, the platform/app-version spread, and first/last `server_ts`.
  Frequency and reach are the priority signal.
- **Discard noise:** errors from extensions/3rd-party scripts (frames pointing
  outside the app bundle), already-fixed crashes (cross-check
  `Todo/Bug_Reports.md` and recent fixes), and transient network blips
  (`status: 0` one-offs) unless they recur across many users.
- **Rank:** crash hitting many users on current `app_version` > crash on a stale
  version > single-user one-off. A reproducible stack trace beats a vague message.

You are the filter. The goal is a curated, de-duplicated, ranked list a developer
can act on — not a raw stack-trace dump.

### 4. Write the entries

Append under the most fitting priority; keep highest-priority first. Every entry
**must** record at least one source `session_id` + `server_ts` as the audit trail
(so a human can trace back to the raw logs).

**`Todo/Crash_Reports.md`** entry template:

```markdown
## [P1] TypeError: cannot read 'body' of undefined — GameScene.update

- **occurrences:** 37  ·  **players affected:** 12  ·  **sessions:** 19
- **first seen:** 2026-06-23 04:11:02  ·  **last seen:** 2026-06-25 18:40:55
- **platform:** android (30), web (7)  ·  **app version:** 1.4.0 (35), 1.3.9 (2)
- **message:** `Cannot read properties of undefined (reading 'body')`
- **top frame:** `GameScene.update (assets/index-ab12.js:9:1423)`
- **sample:** session `s-8f3…` @ 2026-06-25 18:40:55
- **assessment:** Null physics body on the player after respawn; high reach on
  current version → P1.
```

Use `[P1]`/`[P2]`/`[P3]`. The file opens with a two-line header — create it if new,
refresh the date every run:

```markdown
# Crash Reports — from production logs
**Last updated:** YYYY-MM-DD
```

### 5. Advance the cursor

Set `lastProcessedTs` to the **maximum `server_ts` in `logs.json`** (the rows are
sorted desc, so it's the first row) — including discarded rows, so they are never
re-fetched. Signature dedup absorbs any boundary-second overlap. Guard the value:
never advance on a null/empty fetch, or you would skip everything.

```bash
MAX_TS=$(jq -r 'max_by(.server_ts).server_ts' logs.json)
[ "$MAX_TS" = "null" ] || [ -z "$MAX_TS" ] && { echo "no rows — not advancing cursor"; exit 1; }
printf '{ "lastProcessedTs": "%s" }\n' "$MAX_TS" > Todo/crash-log-cursor.json
```

### 6. Open the PR

Branch off `main` (never edit main directly — repo convention). Commit the report
and the cursor together so state and content can never drift apart.

```bash
git checkout main && git pull
git checkout -b crash-logs/triage-$(date +%Y-%m-%d)
git add Todo/Crash_Reports.md Todo/crash-log-cursor.json
git commit -m "chore(logs): triage crash logs through <max_ts>

Filed <N> crash clusters; discarded <D> as noise. Cursor → <max_ts>.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push -u origin HEAD
gh pr create --base main --title "Crash log triage: through <max_ts>" --body "$(cat <<'EOF'
Triaged production crash logs fetched via the fetch-logs Action.

- **Crash clusters filed:** <N>  ·  **Discarded as noise:** <D>
- **Cursor advanced to:** <max_ts>
- Highlights: <one line per P1 cluster>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### 7. Clean up

`rm -f logs.json resp.json` — scratch artifacts, never committed.

## Common mistakes

| Mistake | Consequence | Fix |
|---|---|---|
| Cursoring by id | AE has no id; everything re-filed or skipped | Cursor on `server_ts` |
| Advancing cursor on an ad-hoc / `user_guid` investigation run | Skips the next incremental window | Only the level=error triage run advances the cursor |
| Filing one entry per raw row | Unreadable dump, no priority signal | Cluster by signature first |
| Including signature volatiles (GUIDs, query strings) | Same bug fails to cluster | Strip volatile bits before grouping |
| Calling the SQL API directly to "just check" | Needs the token in your context | Only read via the Action artifact |
| Opening a PR with 0 new rows | Empty noise PR | Stop when `jq length` is 0 |
| Advancing cursor to max-*kept* ts | Discarded rows re-fetched forever | Advance to max `server_ts` of all rows fetched |
| Omitting source session/ts from entries | No audit trail back to raw logs | Every entry lists a sample session + ts |
