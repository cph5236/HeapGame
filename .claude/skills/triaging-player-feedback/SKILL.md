---
name: triaging-player-feedback
description: Use when asked to review, triage, compile, or action HeapGame player feedback — the in-game Bug/Suggestion submissions retrieved via the fetch-feedback GitHub Action — into Bug_Reports.md or Suggestions.md.
---

# Triaging Player Feedback

Players submit bugs and suggestions through the in-game **Send Feedback** button.
Submissions land in a D1 `feedback` table. This skill pulls the unseen rows via the
`fetch-feedback` GitHub Action, triages them with judgment, and files the keepers
into `Todo/Bug_Reports.md` / `Todo/Suggestions.md` in a single PR.

**Core principle:** every run is incremental and idempotent — driven by a committed
**id cursor** — so the same feedback is never filed twice and nothing is skipped.

## Canonical paths — never invent your own

These are fixed. Reusing the same paths every run is what makes dedup work. Do not
relocate them, do not append feedback to `Todo/Bugs.md` (that file is hand-authored).

| Purpose | Path |
|---|---|
| Bug reports (you write) | `Todo/Bug_Reports.md` |
| Suggestions (you write) | `Todo/Suggestions.md` |
| Id cursor (state) | `Todo/feedback-cursor.json` → `{ "lastProcessedId": <int> }` |

If a file does not exist yet, create it (cursor starts at `{ "lastProcessedId": 0 }`).

## Security posture — you never see the admin secret

The `GET /feedback` endpoint is admin-gated. The secret lives **only** in the GitHub
repo secret `ADMIN_SECRET`, injected inside the Action runner. It must never enter
your context. You read feedback solely through the Action's uploaded artifact. Never
curl the endpoint yourself, never ask for the secret.

## Workflow

### 1. Read the cursor

```bash
CURSOR=$(jq -r '.lastProcessedId // 0' Todo/feedback-cursor.json 2>/dev/null || echo 0)
echo "Last processed id: $CURSOR"
```

### 2. Run the Action and download the artifact

`gh workflow run` does not return the run id, and a fresh run takes a moment to
appear. A bare `--limit 1` can grab a *previous* dispatch before the new one
registers — and watching the wrong run corrupts the cursor. Record the newest run
id *before* dispatching, then poll until a different one appears:

```bash
PREV=$(gh run list --workflow=fetch-feedback.yml --limit 1 --json databaseId --jq '.[0].databaseId // 0')
gh workflow run fetch-feedback.yml -f since_id="$CURSOR"
RUN_ID="$PREV"
for _ in $(seq 1 30); do
  RUN_ID=$(gh run list --workflow=fetch-feedback.yml --limit 1 --json databaseId --jq '.[0].databaseId // 0')
  [ "$RUN_ID" != "$PREV" ] && break
  sleep 2
done
gh run watch "$RUN_ID" --exit-status          # blocks until done; nonzero on failure
rm -f feedback.json
gh run download "$RUN_ID" -n feedback          # writes ./feedback.json (artifact name: feedback)
jq 'type=="array" and length' feedback.json    # must print a number; errors if missing/corrupt
```

Rows are `FeedbackRow` objects ordered by `id` ascending (see
[shared/feedbackTypes.ts](../../../shared/feedbackTypes.ts)): `id`, `category`
(`bug`|`suggestion`), `player_guid`, `session_id`, `message`, `app_version`,
`platform`, `heap_id`, `created_at`.

**If `gh run watch` fails or `length` is 0 unexpectedly:** the cause is almost always
a precondition, not your command. Surface it; do not try to fix by obtaining the
secret. Likely causes:
- repo secret `ADMIN_SECRET` or `VITE_HEAP_SERVER_URL` not set
- remote D1 migration not applied (the `feedback` table lives in `heap_telemetry`: `cd server && npx wrangler d1 migrations apply heap_telemetry --remote`)

**If 0 rows:** there is nothing new. Stop — do not open an empty PR. Report "no new
feedback since id N."

### 3. Triage — apply judgment, don't transcribe

The player's chosen `category` is a hint, not a verdict. Read every message and decide:

- **Re-classify.** A "bug" that is really a feature request → Suggestions. A
  "suggestion" describing broken behavior → Bug_Reports. File by what it actually is.
- **Discard** noise: empty/whitespace-equivalent, gibberish (`asdf`, `test`),
  spam, abuse, or anything with no actionable content. Discarded rows still advance
  the cursor — note the count in the PR body, don't file them.
- **Merge duplicates.** Multiple rows describing the same underlying issue become
  **one** entry that lists every source `id` and the count of distinct
  `player_guid`s affected. Frequency is signal.
- **Rank by importance** (bugs): crash / progress-loss / blocker > broken mechanic >
  annoyance > cosmetic. Combine severity with how many players hit it.
- **Assess viability** (suggestions): is it feasible within the game's scope and
  stack (Phaser 2D climber, mobile-first)? Keep reasonable asks even if not
  immediately planned; mark clearly out-of-scope ones as `viability: out of scope`
  with a one-line why rather than silently dropping them.

**Tie-breakers for the calls you will actually agonize over:**
- *Bug or suggestion?* If it reports behavior that contradicts the game's intent →
  **bug**. If it asks for behavior that does not exist yet, or asks "is this
  supposed to…?" about working-as-designed behavior → **suggestion**. When a message
  is both ("X is broken, you should add Y") file the defect as a bug and the ask as a
  suggestion, cross-referencing the shared `id`.
- *Keep or discard?* Discard only when there is **nothing to act on**: gibberish,
  spam, abuse, or bare praise ("great game!"). Keep anything that names a screen,
  mechanic, or frustration you could chase — even vague ones like "the controls feel
  bad on mobile" (file as a low-priority bug/usability note; frequency may promote it
  later). When unsure, keep it: a cheap P3 line beats a lost report.

Worked example — `{category: "bug", message: "sometimes on the slanted part I go
faster, is it supposed to do that?"}`: the "is it supposed to?" framing about a
real mechanic makes this a **suggestion** (clarify slope physics / tutorial),
*unless* other rows report the same speed-up as unwanted — then the cluster is a
physics **bug**. Frequency decides borderline cases.

You are the filter. The goal is a curated, de-duplicated, prioritized list a
developer can act on — not a raw dump.

### 4. Write the entries

Append new entries under the most fitting section; keep highest-priority first.
Every entry **must** record its source `ids` — that is the audit trail proving the
row was filed, and lets a human trace back to the session logs.

**`Todo/Bug_Reports.md`** entry template:

```markdown
## [P1] Player slides off flat plateau tops

- **ids:** 42, 47, 51  ·  **players affected:** 3
- **platform:** android (2), web (1)  ·  **app version:** 1.4.0
- **what they said:** "I keep sliding off the flat bit at the top and die"
- **assessment:** Reproduces the known flat-top wall-misclassification bug.
  High severity (progress loss), multiple reporters → P1.
```

**`Todo/Suggestions.md`** entry template:

```markdown
## Add a daily challenge mode

- **ids:** 39, 45  ·  **players requesting:** 2
- **platform:** android  ·  **app version:** 1.4.0
- **what they said:** "would love a daily climb with a leaderboard reset"
- **viability:** feasible — reuses existing leaderboard + seeded heap. Not yet planned.
```

Use priority tags `[P1]`/`[P2]`/`[P3]` for bugs. Each file opens with a two-line
header — create it if the file is new, refresh the date every run:

```markdown
# Bug Reports — from player feedback
**Last updated:** YYYY-MM-DD
```

(Use `# Suggestions — from player feedback` for the other file.) Entries follow below.

### 5. Advance the cursor

Set `lastProcessedId` to the **maximum `id` in `feedback.json`** — including discarded
rows, so they are never re-fetched. Guard the value: never advance the cursor on a
null/empty fetch, or you would skip everything.

```bash
MIN_ID=$(jq '[.[].id] | min' feedback.json)    # for the PR title/commit range
MAX_ID=$(jq '[.[].id] | max' feedback.json)
[ "$MAX_ID" = "null" ] || [ -z "$MAX_ID" ] && { echo "no rows — not advancing cursor"; exit 1; }
printf '{ "lastProcessedId": %s }\n' "$MAX_ID" > Todo/feedback-cursor.json
```

### 6. Open the PR

Branch off `main` (never edit main directly — repo convention). Commit the report
files **and** the cursor together so state and content can never drift apart.

```bash
git checkout main && git pull
git checkout -b feedback/triage-$(date +%Y-%m-%d)
git add Todo/Bug_Reports.md Todo/Suggestions.md Todo/feedback-cursor.json
git commit -m "chore(feedback): triage player feedback ids <min>–<max>

Filed <B> bugs, <S> suggestions; discarded <D> as noise. Cursor → <max>.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push -u origin HEAD
gh pr create --base main --title "Player feedback triage: ids <min>–<max>" --body "$(cat <<'EOF'
Triaged player feedback fetched via the fetch-feedback Action.

- **Bugs filed:** <B>  ·  **Suggestions filed:** <S>  ·  **Discarded as noise:** <D>
- **Cursor advanced to:** id <max>
- Highlights: <one line per P1 bug / notable suggestion>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### 7. Clean up

`rm -f feedback.json` — it is a scratch artifact, never committed.

## Common mistakes

| Mistake | Consequence | Fix |
|---|---|---|
| Inventing a state-file path (e.g. `docs/feedback-state.json`) | Cursor differs run-to-run → everything re-filed or skipped | Use `Todo/feedback-cursor.json` only |
| Appending to `Todo/Bugs.md` | Clobbers hand-authored notes | Write to `Todo/Bug_Reports.md` |
| Trusting the player's `category` verbatim | Bugs filed as suggestions and vice-versa | Re-classify by actual content |
| Advancing cursor to max-*kept* id | Discarded rows re-fetched forever | Advance to max id of all rows fetched |
| `gh run download` immediately after `gh workflow run` | Artifact not ready → download fails | `gh run watch --exit-status` first |
| Curling `/feedback` to "just check" | Needs the admin secret in your context | Only read via the Action artifact |
| Opening a PR with 0 new rows | Empty noise PR | Stop when `jq length` is 0 |
| Omitting source `ids` from entries | No audit trail; future runs can't tell it was filed | Every entry lists its `ids` |
