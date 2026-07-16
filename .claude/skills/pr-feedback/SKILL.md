---
name: pr-feedback
description: Use when asked to pull, check, or action review feedback on a HeapGame GitHub PR — from the automated Claude review-bot or a human reviewer — e.g. "grab the bot's comments on the PR and action them", "address the code review on the PR", "see what the reviewer said and fix it".
---

# Actioning PR Review Feedback

Pull review feedback off a GitHub PR — from the automated Claude reviewer **and**
any human reviewer — triage it, and apply what's worth applying, consulting the
user on anything major.

The Claude reviewer is the `claude-code-review.yml` Action, posting as
`claude[bot]`; its tracking comment starts with `**Claude finished @<user>'s
task**`. **Login gotcha:** `gh pr view --json` (GraphQL) reports the login as
`claude` with the `[bot]` suffix **stripped**, while the REST API (`gh api`) keeps
`claude[bot]`. Always match the login **case-insensitively with `test("claude")`**
so both forms hit — an exact `=="claude"` silently misses the REST results.

## When to use
- A reviewer — the Claude bot or a human — has (or should have) left feedback on a PR and you want to act on it.
- **Not** for reviewing a PR yourself → that's `/review`.
- **Not** for your local uncommitted diff → that's `/code-review`.

## Steps

1. **Find the PR.** Use the number if the user gave one; otherwise the current branch's PR:
   ```bash
   gh pr view --json number,url -q .number
   ```

2. **Gather the feedback** — two sources, both matter:

   **a) The Claude review bot's comment** (a tracking issue-comment). `gh pr view`
   is GraphQL, which strips the `[bot]` suffix, so `test("claude";"i")` matches:
   ```bash
   gh pr view <N> --json comments \
     -q '[.comments[] | select(.author.login | test("claude";"i"))] | last | .body'
   ```

   **b) Any human (or other) reviewer** — formal reviews and inline comments via the
   REST API, which keeps the real `[bot]` suffix. Take every author **except** known
   deploy/CI bots (cloudflare-workers-and-pages, dependabot, codecov…):
   ```bash
   gh api repos/{owner}/{repo}/pulls/<N>/reviews \
     --jq '.[] | select(.body != "" and (.user.login | test("cloudflare|dependabot|codecov";"i") | not))
                | "@\(.user.login) [\(.state)]: \(.body)"'
   gh api repos/{owner}/{repo}/pulls/<N>/comments \
     --jq '.[] | "@\(.user.login) \(.path):L\(.line): \(.body)"'
   ```

   Triage **all** of it — the Claude bot, a teammate's review, an inline nit. If
   nothing relevant is there yet, the review Action may still be running — check the
   PR's Actions run and wait. **Do not guess at the feedback.**

3. **Triage with rigor.** REQUIRED SUB-SKILL: invoke `superpowers:receiving-code-review`.
   Verify each finding against the actual code before acting — don't blindly
   implement, don't reflexively dismiss.

4. **Action the findings:**
   - **Clear, correct, low-risk** (bugs, typos, doc drift, small fixes) → fix directly.
   - **Major** (architectural, behavior-changing, security-relevant, ambiguous,
     or the reviewer may be wrong) → **consult the user before acting**, unless
     they told you this run to proceed autonomously.
   - **Invalid / out-of-scope** → skip, and say why in the summary.

5. **Commit + push to the PR branch** — never merge. Follow repo commit
   conventions; leave unrelated working-tree changes untouched.

6. **Summarize:** what you fixed, what you deferred to the user, what you
   rejected and why.

## Notes
- The Claude bot re-reviews after each push — take its **newest** comment. Human
  reviews don't refresh, so read every one.
- Findings usually sit under a "Minor issues" / "Findings" / "Review summary" heading.
