---
name: pr-feedback
description: Use when asked to pull, check, or action the automated Claude review-bot's feedback on a HeapGame GitHub PR — e.g. "grab the bot's comments on the PR and action them", "address the code review the bot left", "see what the review bot said and fix it".
---

# Actioning PR Bot Feedback

Pull the automated Claude reviewer's comment off a GitHub PR, triage its
findings, and apply the ones worth applying — consulting the user on anything
major. The reviewer is the `claude-code-review.yml` GitHub Action; it posts as
the `claude` user and signs off with "Claude finished reviewing".

## When to use
- The review bot has (or should have) left a comment on a PR and you want to act on it.
- **Not** for reviewing a PR yourself → that's `/review`.
- **Not** for your local uncommitted diff → that's `/code-review`.

## Steps

1. **Find the PR.** Use the number if the user gave one; otherwise the current branch's PR:
   ```bash
   gh pr view --json number,url -q .number
   ```

2. **Fetch the bot's feedback** (author `claude`), newest first — check both issue comments and formal reviews:
   ```bash
   gh pr view <N> --json comments \
     -q '[.comments[] | select(.author.login=="claude")] | last | .body'
   gh api repos/{owner}/{repo}/pulls/<N>/reviews \
     -q '[.[] | select(.user.login=="claude")] | last | .body'
   ```
   If nothing is there yet, the review Action may still be running — check the
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
- Take the **newest** bot comment — it re-reviews after each push.
- Findings usually sit under a "Minor issues" / "Findings" / "Review summary" heading.
