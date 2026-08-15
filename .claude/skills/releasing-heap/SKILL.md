---
name: releasing-heap
description: Use when asked to cut a HeapGame release, bump the version, write Play Console release notes, ship to Play/itch.io, or when a "V0.x.y" version commit is needed after merging feature PRs.
---

# Releasing Heap

A release is a **version-bump commit on `main`** (message `V<version>`, e.g.
`V0.2.16`) pushed by the user. The push fans out through CI automatically:

| Workflow | Does |
|---|---|
| `mobile.yml` | `build:android` → signed AAB + mapping → Play **internal track** (Gradle Play Publisher) |
| `release-itchio.yml` | web build → itch.io |
| `deploy.yml` | web build → GitHub Pages |
| `migrate-d1.yml` | remote D1 migrations (only if `server/migrations/**` changed) |

The Cloudflare Worker rides along too, but **not** through GitHub Actions — no
workflow here runs `wrangler deploy`. It deploys off `main` through Cloudflare's
own Git integration (Workers Builds: repo `cph5236/HeapGame`, root directory
`/server/`, deploy command `npx wrangler deploy`, watch paths `*`). Non-production
branches build too, which is the `cloudflare-workers-and-pages` bot you see on PRs.

**Never tell the user to run `wrangler deploy` by hand.** It is automatic.

## Procedure

1. **Preconditions** — on `main`, up to date, clean tree; `npm test` and
   `npm run build` green; all intended PRs merged.
2. **Bump**:
   ```bash
   npm run bump            # patch (default) | npm run bump minor | major
   ```
   Updates `package.json` version + `android/app/build.gradle`
   `versionCode`/`versionName` together — never edit these by hand or they drift.
3. **Write the Play release notes** — see the section below. Every release.
4. **Commit** exactly those three files with message `V<new version>` (e.g. `V0.2.17`).
5. **Stop — do not push.** The user reviews and pushes `main` themselves
   (release = production publish). Tell them what the push will trigger, including
   any pending remote migration.

## Release notes (Play Console)

Rewrite `android/app/src/main/play/release-notes/en-US/internal.txt` on every
release. GPP resolves notes as `play/release-notes/<locale>/<track>.txt`, and
`build.gradle` sets `track = "internal"` — so `internal.txt` is the file Play
actually shows. It sat as the placeholder `Internal build. See git log for
changes.` from the GPP setup through V0.2.25, so **never assume the existing
text is current** — it is either a placeholder or the previous release's notes.

Format: a simple list, one short plain line per player-facing change, blank line
between. No bullets, no headings, no version number.

```
Leaderboard scores are now verified against server time, so run times can't be faked.

The main menu no longer re-checks your Daily Drop when there's nothing to claim, so it opens faster, and the can now counts down to your next drop.
```

- **Player-facing only.** Drop what a player cannot see: landing-page/SEO work,
  server refactors, tests, CI, tooling. A 3-PR release often yields 2 lines.
- Say the effect on the player, not the mechanism. No PR numbers, no file or
  symbol names, no internal jargon.
- **500 characters max** per locale — Play rejects longer. Check with
  `wc -m android/app/src/main/play/release-notes/en-US/internal.txt`.
- `internal.txt` is the only file needed. Promoting internal → production in the
  console carries these notes forward and lets the user edit them there.

## Checks before handing off

- Server changed since last release? → say so, so they know the Worker redeploys
  as part of this push. Nothing manual to do.
- New migrations in the release? → confirm `migrate-d1.yml` will pick them up, and
  whether the worker must wait for it (schema-dependent code).
- `git log <last V tag/commit>..HEAD --oneline` — sanity-scan what's shipping.

## Rules

- The `V0.x.y` commit is the **only** direct-to-main commit pattern in this repo,
  and only the user pushes it.
- Bump type is the user's call if ambiguous — default is `patch`; ask only when
  the shipped changes look minor/major.
