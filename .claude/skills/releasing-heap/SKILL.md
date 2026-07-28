---
name: releasing-heap
description: Use when asked to cut a HeapGame release, bump the version, ship to Play/itch.io, or when a "V0.x.y" version commit is needed after merging feature PRs.
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
3. **Commit** exactly those two files with message `V<new version>` (e.g. `V0.2.17`).
4. **Stop — do not push.** The user reviews and pushes `main` themselves
   (release = production publish). Tell them what the push will trigger, including
   any pending remote migration.

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
