# iOS Build via CI-Generated Capacitor + TestFlight — Design

**Date:** 2026-06-09
**Status:** Approved (design)
**Branch:** `feature/ios-build`
**Source item:** [Todo_Playtest_Feedback.md](../../../Todo/Todo_Playtest_Feedback.md) item 6 — iOS build

---

## 1. Summary

Ship an iOS build of Heap to TestFlight using a **macOS GitHub Actions job that
generates the `ios/` Capacitor project on demand**, configures it for
portrait / anonymous / ad-free, archives it, and uploads to TestFlight — fired
only when the `package.json` version changes. No iOS-native code is committed to
the repo; the `ios/` project exists only ephemerally inside the CI job.

This is viable because the codebase is already platform-aware:
- [PlayGamesClient.ts](../../../src/systems/PlayGamesClient.ts) guards every call
  with `isAndroid()` and returns `null` / no-ops elsewhere, so Google Play Games
  Services silently disables on iOS with **zero code changes**.
- [AdClient.ts](../../../src/systems/ads/AdClient.ts) selects `NullProvider` unless
  `VITE_AD_PROVIDER=admob`, so building without that env var yields an ad-free app.
- [safeArea.ts](../../../src/utils/safeArea.ts) already reads CSS
  `env(safe-area-inset-*)`, which WKWebView supports.
- `ios/` is **already gitignored**, confirming the repo was set up for a
  CI-generated (not committed) iOS project.

## 2. Decisions (from brainstorming)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Mac access | **macOS GitHub Actions runner only** (no local Mac) | CI owns the entire native layer |
| `ios/` lifecycle | **CI-generated, never committed** (Approach A) | No local Mac; no custom Swift; matches existing `.gitignore` |
| iOS identity / social | **Anonymous-only** — no Game Center | Server `/scores` leaderboard + local saves still fully work; zero native plugin work |
| Ads on iOS | **Ad-free** (NullProvider) | Avoids ATT / AdMob privacy-review friction on first submission |
| Distribution | **TestFlight beta first** | Mirrors the Android closed-beta plan; App Store submission later |
| CI trigger | **Version-diff guard** on push to `main` (+ `workflow_dispatch`) | Build fires exactly on a version bump; ordinary commits skip |

## 3. Scope

**In scope**
- A macOS GitHub Actions job (`ios.yml`) that generates, configures, archives, and
  ships the iOS app to TestFlight, gated to version-change events.
- An Info.plist patch script applied after `cap add ios` (the project is
  regenerated each run, so all native config must be code, not hand-clicked).
- fastlane config for signing (App Store Connect API key) + TestFlight upload.
- iOS icon / launch-screen generation via `@capacitor/assets`.
- Device smoke test on a physical iPhone via TestFlight (the user has one).
- A one-time manual-setup doc (Apple enrollment, app record, secrets).

**Out of scope (explicit non-goals)**
- Game Center / achievements / iCloud saves — GPGS stays Android-only and already
  no-ops on iOS. (Future work; would flip `ios/` lifecycle to "committed", Approach B.)
- AdMob on iOS — `NullProvider` is used; no ATT prompt, no ad-unit IDs.
- App Store public submission — TestFlight only for now.
- Committing the `ios/` directory to git.
- Any `src/` game-logic change, except reactive WKWebView fixes surfaced by the
  smoke test (e.g. audio unlock).

## 4. Components

| # | Artifact | Type | Purpose |
|---|----------|------|---------|
| 1 | `.github/workflows/ios.yml` | new | macOS CI job: guard → generate → patch → archive → TestFlight |
| 2 | `scripts/ios-patch-plist.sh` | new | Post-`cap add ios` Info.plist mutations via PlistBuddy |
| 3 | `scripts/ios-version-guard.sh` | new | Exit job early unless `package.json` version changed vs `HEAD~1` |
| 4 | `fastlane/Fastfile` + `fastlane/Appfile` | new | `build_app` (gym) + `upload_to_testflight` (pilot) with ASC API key |
| 5 | `assets/icon.png` (1024×1024) | verify/add | Source for `@capacitor/assets` iOS icon + splash generation |
| 6 | `package.json` | edit | Add `build:ios` script (+ optional `cap:ios`) |
| 7 | `capacitor.config.ts` | edit | Add `ios: { scheme: 'Heap' }`; confirm `webDir` / server settings |
| 8 | `docs/superpowers/specs/ios-setup.md` (or sibling) | new | One-time manual steps (Apple enrollment, ASC app record, secrets) |

No `src/` game-logic changes are required for the build to function — the
`isAndroid()` guards make GPGS no-op and `NullProvider` is the default ad provider.

## 5. CI flow (`ios.yml`)

```
on: push to main (+ workflow_dispatch)
job (runs-on: macos-14):
  1. checkout (fetch-depth: 2 — need HEAD~1 for the version guard)
  2. scripts/ios-version-guard.sh → if version unchanged, exit job early (green)
  3. setup-node 24, npm ci
  4. npm run build                        # web bundle, ad-free (no VITE_AD_PROVIDER)
     env: VITE_HEAP_SERVER_URL=${{ secrets.VITE_HEAP_SERVER_URL }}  # else clients default to localhost
  5. npx cap add ios                      # generate ios/ + pod install
  6. npx @capacitor/assets generate --ios # icons + splash from assets/icon.png
  7. scripts/ios-patch-plist.sh           # portrait, display name, GADApplicationIdentifier,
                                          #   ITSAppUsesNonExemptEncryption=false, rerun-safe build number
  8. npx cap sync ios
  9. fastlane ios beta                    # ASC-API-key sign, archive, upload to TestFlight
```

- **PRs build nothing** — the web `ci.yml` already covers the web layer, and there
  is nothing iOS-native to verify on a PR. Keeps runs minimal.
- Structure mirrors the existing Android job in
  [mobile.yml](../../../.github/workflows/mobile.yml), swapping
  Linux/Gradle/Play-Console for macOS/fastlane/TestFlight.
- Public repo → macOS runners are free; the version guard is about avoiding wasted
  runs, not cost.

### Version guard

`ios-version-guard.sh` compares the `version` field of `package.json` at `HEAD`
against `git show HEAD~1:package.json`. If equal, it signals the job to stop early
(green, no build). The user already bumps via `npm run bump` / `npm run version:patch`,
so **bump + push = build; ordinary commits = skip**. The CI **build number** is
derived from `github.run_number * 100 + github.run_attempt` (not the version), so
it stays monotonic *and changes on workflow re-runs* — `run_number` alone is reused
on a rerun, which TestFlight rejects as a duplicate `CFBundleVersion`. Including
`run_attempt` (which increments per rerun) makes every upload distinct. The `* 100`
multiplier reserves headroom for up to 99 reruns of a given run before collision.

## 6. Info.plist patch (the crux of "no committed native code")

Because `ios/` is regenerated every run, all native configuration is expressed as
code in `ios-patch-plist.sh`, applied after `cap add ios` using `PlistBuddy`
(ships with macOS):

| Key | Value | Why |
|-----|-------|-----|
| `UISupportedInterfaceOrientations` | portrait only | Mirrors Android `screenOrientation="portrait"` |
| `CFBundleDisplayName` | `Heap` | App name on the home screen |
| `CFBundleShortVersionString` | `package.json` version (e.g. `0.2.5`) | Marketing version |
| `CFBundleVersion` | `run_number * 100 + run_attempt` | Monotonic **and rerun-safe** build number; `run_number` alone repeats on a rerun and TestFlight rejects duplicates |
| `GADApplicationIdentifier` | AdMob official **test app ID** | The `@capacitor-community/admob` pod is still installed by `cap add ios`; the Google Mobile Ads SDK **hard-crashes at launch if this key is absent**, even when no ad is ever requested. The test ID keeps the app ad-free and crash-free. |
| `ITSAppUsesNonExemptEncryption` | `false` | Auto-clears the export-compliance prompt on each TestFlight upload |

## 7. Signing & secrets (one-time, requires the Apple account)

- fastlane uses a **Team-scoped App Store Connect API key** with
  `-allowProvisioningUpdates` (Xcode automatic cloud-managed signing), avoiding the
  `match` certificate-repo overhead for a solo TestFlight flow. The key **must be a
  Team key, not an Individual key** — Individual keys cannot call the provisioning
  endpoints automatic signing depends on, so an Individual key fails at setup time.
- `match` is the future fallback if pinned, reproducible certs across machines are
  ever wanted (e.g. once a Game Center Swift plugin forces a committed `ios/`).
- **GitHub Secrets:** `VITE_HEAP_SERVER_URL` (production backend URL, same secret the
  Android job uses), `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_API_KEY_P8` (base64-encoded).
- **Manual prerequisites** (documented in the setup doc — CI cannot do these):
  1. Enroll in the Apple Developer Program ($99/yr).
  2. Register App ID `com.hanlinsoftware.heapgame.app`.
  3. Create the App Store Connect app record.
  4. Generate the App Store Connect API key (.p8) and add the three secrets.

## 8. Testing & verification

**CI green path**
- Version guard correctly skips on an unchanged version and runs on a bump.
- `cap add ios` + `pod install` succeed on the runner.
- `@capacitor/assets generate --ios` produces a complete icon set + launch screen.
- Archive + TestFlight upload succeed (build appears in App Store Connect).

**Device smoke test (user, via TestFlight on a physical iPhone)**
- Game boots in WKWebView and renders.
- Touch controls + device tilt work.
- **Audio unlocks on first tap** — highest-risk item; WKWebView audio-unlock
  timing differs from Android's WebView and `AudioFocusGuard` was Android-tuned.
- Server leaderboard (`/scores`) loads.
- Safe-area insets respected on a notched device.
- Portrait lock holds.

**Reactive fixes**
- Any WKWebView audio / rendering issue is fixed on this branch under
  `systematic-debugging`, in `AudioFocusGuard` / `AudioManager` or related `src`.

## 9. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| AdMob pod crash-on-launch (no `GADApplicationIdentifier`) | Patch script injects the AdMob test app ID |
| WKWebView audio/perf differs from Android WebView | Physical-iPhone smoke test; reactive fix on branch |
| Duplicate `CFBundleVersion` rejected by TestFlight | Build number = `run_number * 100 + run_attempt` — monotonic *and* distinct on reruns |
| iOS archive points at `localhost` backend (clients read `VITE_HEAP_SERVER_URL` at build time, `.env` defaults to localhost) | Inject `VITE_HEAP_SERVER_URL` secret in the build step, same as the Android job |
| Individual ASC API key cannot do provisioning → signing fails at setup | Require a **Team** App Store Connect API key |
| Wasted macOS runs on every commit | Version-diff guard exits early unless version changed |
| Missing iOS icons/launch screen | `@capacitor/assets generate --ios` step before archive |
| Export-compliance prompt blocking upload | `ITSAppUsesNonExemptEncryption=false` in Info.plist |
| One-time Apple paperwork gates first upload | Documented prerequisites; CI handles everything after |

## 10. Definition of done

- `ios.yml`, patch/guard scripts, and fastlane config committed on
  `feature/ios-build`; PR opened.
- A version bump on `main` produces a TestFlight build with no manual steps
  (after the one-time Apple setup).
- The TestFlight build installs and runs acceptably on the user's iPhone
  (boots, renders, audio unlocks, controls work, leaderboard loads, portrait-locked).
- Setup doc lists the one-time Apple prerequisites and required GitHub Secrets.
