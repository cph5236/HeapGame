# Ad Integration Design
**Date:** 2026-05-28
**Status:** Approved

## Overview

Add a platform-agnostic ad provider system to Heap. The initial implementation wires up AdMob for Android. All other build targets (itch.io web, future GameDistribution, CrazyGames, YouTube Playables) use a no-op NullProvider. Game logic never calls an SDK directly — it only calls `AdClient`.

---

## Architecture

### Provider Interface

```
src/systems/ads/
  AdProvider.ts       ← interface
  NullProvider.ts     ← no-op impl (web / itch.io)
  AdMobProvider.ts    ← @capacitor-community/admob wrapper (Android)
  AdClient.ts         ← singleton, selects provider via VITE_AD_PROVIDER
```

**`AdProvider` interface:**
```typescript
interface AdProvider {
  initialize(): Promise<void>;
  showInterstitial(): Promise<void>;
  showRewarded(): Promise<boolean>; // true = user watched to completion
}
```

### Provider Selection

`AdClient.ts` uses a Vite `define`-substituted constant to select the provider at build time:

```typescript
const p: AdProvider =
  (import.meta.env.VITE_AD_PROVIDER as string) === 'admob'
    ? new AdMobProvider()
    : new NullProvider();
export const AdClient = p;
```

Rollup resolves the literal string at build time and tree-shakes the unused branch. The `@capacitor-community/admob` import only reaches the Android bundle.

`AdClient.initialize()` is called once in `BootScene.create()`, immediately after `AudioManager.init(this.sound)`, as a fire-and-forget (`.then()`) — it does not block the scene transition to MenuScene.

---

## Build Scripts

```json
"build": "tsc && vite build",
"build:android": "VITE_AD_PROVIDER=admob tsc && vite build && cap sync"
```

The existing `build` script is unchanged. `build:android` produces an AdMob-wired bundle and syncs it to Capacitor. The Android CI workflow (`mobile.yml`) must be updated to call `npm run build:android` instead of `npm run build`.

### Vite Config Additions

```typescript
define: {
  'import.meta.env.VITE_AD_PROVIDER': JSON.stringify(process.env.VITE_AD_PROVIDER || 'null'),
  'import.meta.env.VITE_ADMOB_INTERSTITIAL_ID': JSON.stringify(process.env.VITE_ADMOB_INTERSTITIAL_ID || 'ca-app-pub-3940256099942544/1033173712'),
  'import.meta.env.VITE_ADMOB_REWARDED_ID': JSON.stringify(process.env.VITE_ADMOB_REWARDED_ID || 'ca-app-pub-3940256099942544/5224354917'),
}
```

Test ad unit IDs are used as fallbacks. Production IDs are set as GitHub Actions secrets and passed via env vars in CI.

---

## AdMob Provider

Uses `@capacitor-community/admob`.

**`initialize()`:**
- Calls `AdMob.initialize({ requestAdOptions: { tagForChildDirectedTreatment: true } })`
- Child-directed treatment flags all requests as COPPA-compliant (required for Families Policy)
- Preloads the interstitial immediately after init

**`showInterstitial()`:**
- Loads interstitial if not already loaded, then shows it
- Catches all errors silently — never interrupts the game flow
- AdMob console frequency cap handles actual show rate (no client-side counter needed)

**`showRewarded()`:**
- Loads a rewarded ad, shows it
- Returns `true` only if `RewardAdPluginEvents.Rewarded` fires before the ad closes
- Returns `false` on error, user skip, or no fill

### Android Setup

1. Install `@capacitor-community/admob` via npm
2. Gradle adds the AdMob dependency automatically via the Capacitor plugin
3. Add AdMob App ID to `android/app/src/main/AndroidManifest.xml`:
   ```xml
   <meta-data
     android:name="com.google.android.gms.ads.APPLICATION_ID"
     android:value="ca-app-pub-XXXXXXXXXXXXXXXX~XXXXXXXXXX"/>
   ```
4. `minSdkVersion` is already compatible (AdMob requires 21+)

---

## ScoreScene Integration

### Interstitial

Called at the top of `ScoreScene.create()` before any UI is rendered:

```typescript
await AdClient.showInterstitial();
```

This is the natural between-runs gate. The scene waits for the ad to close (or error) before rendering. `NullProvider.showInterstitial()` resolves immediately.

### Rewarded Ad — "2× Coins"

A "Watch ad → 2× coins" button is rendered alongside the coin total in ScoreScene. Behavior:

- Always rendered (the button is the offer — outcome is unknown until the user taps)
- On tap: calls `AdClient.showRewarded()`
  - If `true`: doubles the coins earned this run by calling `addBalance()` again with the original amount; updates the displayed coin total
  - If `false`: no coins granted (user skipped, no fill, or `NullProvider`)
- Button disappears after one tap regardless of outcome — no second attempt

On `NullProvider` (web / itch.io), `showRewarded()` always returns `false`, so the button shows but never grants coins. This is intentional: the button is invisible cost to non-Android builds, and keeps the code path identical across platforms.

---

## Testing

| Test | Location | What it covers |
|---|---|---|
| `NullProvider` unit tests | `src/systems/ads/__tests__/NullProvider.test.ts` | All methods resolve; `showRewarded` resolves `false` |
| `AdClient` selection tests | `src/systems/ads/__tests__/AdClient.test.ts` | Provider selection logic by `VITE_AD_PROVIDER` value |
| `AdMobProvider` | Manual on-device smoke test | SDK not unit-testable; error paths covered by NullProvider pattern |
| ScoreScene rewarded flow | scene-preview + manual | Mock `AdClient` module to return `true`; verify coin doubling |

---

## Play Console Action Required

After this feature ships to production:

> **App content → Advertising ID**: change declaration from **No → Yes**

The AdMob SDK auto-merges `AD_ID` into the manifest. Without updating this declaration, Play Console will block releases targeting Android 13+.

---

## Out of Scope

- GameDistribution, CrazyGames, YouTube Playables provider implementations (stubs only, not wired)
- Banner ads (skip entirely — poor fit for a fullscreen game)
- Server-side ad orchestration
- A/B testing ad placements
