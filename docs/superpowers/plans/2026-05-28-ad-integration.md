# Ad Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a platform-agnostic ad provider system with AdMob wired up for Android and a NullProvider for all other builds.

**Architecture:** `AdProvider` interface + `NullProvider` (web/itch.io) + `AdMobProvider` (Android via `@capacitor-community/admob@8`). A Vite `define`-substituted constant (`VITE_AD_PROVIDER`) selects the active provider at build time so unused SDK code is tree-shaken out. Game logic only ever imports `AdClient`.

**Tech Stack:** `@capacitor-community/admob@8.0.0`, Vite 6 `define`, Capacitor 8.2, Phaser 3 (ScoreScene), Vitest.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/systems/ads/AdProvider.ts` | Interface: `initialize`, `showInterstitial`, `showRewarded` |
| Create | `src/systems/ads/NullProvider.ts` | No-op impl for web/itch.io |
| Create | `src/systems/ads/AdMobProvider.ts` | `@capacitor-community/admob` wrapper |
| Create | `src/systems/ads/AdClient.ts` | Singleton — selects provider via `VITE_AD_PROVIDER` |
| Create | `src/systems/ads/__tests__/NullProvider.test.ts` | Unit tests for NullProvider |
| Modify | `vite.config.ts` | Add `VITE_AD_PROVIDER`, `VITE_ADMOB_INTERSTITIAL_ID`, `VITE_ADMOB_REWARDED_ID` defines |
| Modify | `package.json` | Add `build:android` script |
| Modify | `android/app/src/main/AndroidManifest.xml` | Add AdMob App ID meta-data |
| Modify | `android/app/src/main/res/values/strings.xml` | Add `admob_app_id` string resource |
| Modify | `src/scenes/BootScene.ts` | Call `AdClient.initialize()` fire-and-forget after `AudioManager.init()` |
| Modify | `src/scenes/ScoreScene.ts` | Interstitial in `create()` + rewarded "2× coins" button |
| Modify | `.github/workflows/mobile.yml` | Use `build:android`, add ADMOB env var secrets |

---

## Task 1: Install @capacitor-community/admob

**Files:**
- Modify: `package.json` (via npm)
- Modify: `android/` (via cap sync — Gradle deps + plugin registration)

- [ ] **Step 1: Install the package**

```bash
npm install @capacitor-community/admob@8.0.0
```

Expected: package added to `node_modules` and `package.json` dependencies.

- [ ] **Step 2: Sync with Capacitor to register the native plugin**

```bash
npx cap sync android
```

Expected: output includes `@capacitor-community/admob` in the sync list; no errors. This adds the Gradle dependency to the Android project automatically.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json android/
git commit -m "chore: install @capacitor-community/admob@8"
```

---

## Task 2: AdProvider Interface + NullProvider + Unit Tests

**Files:**
- Create: `src/systems/ads/AdProvider.ts`
- Create: `src/systems/ads/NullProvider.ts`
- Create: `src/systems/ads/__tests__/NullProvider.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/systems/ads/__tests__/NullProvider.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { NullProvider } from '../NullProvider';

describe('NullProvider', () => {
  it('initialize resolves without throwing', async () => {
    const p = new NullProvider();
    await expect(p.initialize()).resolves.toBeUndefined();
  });

  it('showInterstitial resolves without throwing', async () => {
    const p = new NullProvider();
    await expect(p.showInterstitial()).resolves.toBeUndefined();
  });

  it('showRewarded resolves false', async () => {
    const p = new NullProvider();
    await expect(p.showRewarded()).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- src/systems/ads/__tests__/NullProvider.test.ts
```

Expected: FAIL — `Cannot find module '../NullProvider'`

- [ ] **Step 3: Create the AdProvider interface**

Create `src/systems/ads/AdProvider.ts`:

```typescript
export interface AdProvider {
  initialize(): Promise<void>;
  showInterstitial(): Promise<void>;
  showRewarded(): Promise<boolean>;
}
```

- [ ] **Step 4: Create NullProvider**

Create `src/systems/ads/NullProvider.ts`:

```typescript
import type { AdProvider } from './AdProvider';

export class NullProvider implements AdProvider {
  async initialize(): Promise<void> {}
  async showInterstitial(): Promise<void> {}
  async showRewarded(): Promise<boolean> { return false; }
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npm test -- src/systems/ads/__tests__/NullProvider.test.ts
```

Expected: PASS — 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/systems/ads/AdProvider.ts src/systems/ads/NullProvider.ts src/systems/ads/__tests__/NullProvider.test.ts
git commit -m "feat(ads): AdProvider interface + NullProvider"
```

---

## Task 3: AdMobProvider

**Files:**
- Create: `src/systems/ads/AdMobProvider.ts`

No unit tests — the AdMob SDK is a native Capacitor plugin that cannot be mocked in Vitest's Node environment. Correctness is verified by on-device smoke test.

- [ ] **Step 1: Create AdMobProvider**

Create `src/systems/ads/AdMobProvider.ts`:

```typescript
import {
  AdMob,
  AdOptions,
  RewardAdOptions,
  InterstitialAdPluginEvents,
  RewardAdPluginEvents,
} from '@capacitor-community/admob';
import type { AdProvider } from './AdProvider';

const INTERSTITIAL_ID = import.meta.env.VITE_ADMOB_INTERSTITIAL_ID as string;
const REWARDED_ID     = import.meta.env.VITE_ADMOB_REWARDED_ID as string;

export class AdMobProvider implements AdProvider {
  async initialize(): Promise<void> {
    try {
      await AdMob.initialize({ tagForChildDirectedTreatment: true });
      this._preloadInterstitial();
    } catch { /* silent — never interrupt boot */ }
  }

  async showInterstitial(): Promise<void> {
    try {
      await AdMob.showInterstitial();
      this._preloadInterstitial(); // reload for next run
    } catch { /* no fill or not loaded — silent */ }
  }

  async showRewarded(): Promise<boolean> {
    try {
      const options: RewardAdOptions = { adId: REWARDED_ID };
      await AdMob.prepareRewardVideoAd(options);

      return await new Promise<boolean>((resolve) => {
        let rewarded = false;

        const rewardedHandle = AdMob.addListener(RewardAdPluginEvents.Rewarded, () => {
          rewarded = true;
        });

        const dismissedHandle = AdMob.addListener(RewardAdPluginEvents.Dismissed, () => {
          Promise.all([rewardedHandle, dismissedHandle])
            .then(([rh, dh]) => { rh.remove(); dh.remove(); });
          resolve(rewarded);
        });

        AdMob.showRewardVideoAd().catch(() => {
          Promise.all([rewardedHandle, dismissedHandle])
            .then(([rh, dh]) => { rh.remove(); dh.remove(); });
          resolve(false);
        });
      });
    } catch {
      return false;
    }
  }

  private _preloadInterstitial(): void {
    const options: AdOptions = { adId: INTERSTITIAL_ID };
    AdMob.prepareInterstitial(options).catch(() => { /* no fill — silent */ });
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build
```

Expected: build succeeds. If `@capacitor-community/admob` types are missing, check that `npm install` from Task 1 completed. The `AdMobProvider` imports are only included in `build:android` bundles (Task 5 wires that up).

- [ ] **Step 3: Commit**

```bash
git add src/systems/ads/AdMobProvider.ts
git commit -m "feat(ads): AdMobProvider wrapping @capacitor-community/admob"
```

---

## Task 4: AdClient Singleton + Vite Config + Build Script

**Files:**
- Create: `src/systems/ads/AdClient.ts`
- Modify: `vite.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Create AdClient**

Create `src/systems/ads/AdClient.ts`:

```typescript
import type { AdProvider } from './AdProvider';
import { NullProvider } from './NullProvider';
import { AdMobProvider } from './AdMobProvider';

const _provider: AdProvider =
  (import.meta.env.VITE_AD_PROVIDER as string) === 'admob'
    ? new AdMobProvider()
    : new NullProvider();

export const AdClient: AdProvider = _provider;
```

- [ ] **Step 2: Update vite.config.ts — add defines**

Open `vite.config.ts`. The current `define` block looks like:

```typescript
define: {
  'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
},
```

Replace it with:

```typescript
define: {
  'import.meta.env.VITE_APP_VERSION':          JSON.stringify(pkg.version),
  'import.meta.env.VITE_AD_PROVIDER':          JSON.stringify(process.env.VITE_AD_PROVIDER || 'null'),
  'import.meta.env.VITE_ADMOB_INTERSTITIAL_ID': JSON.stringify(process.env.VITE_ADMOB_INTERSTITIAL_ID || 'ca-app-pub-3940256099942544/1033173712'),
  'import.meta.env.VITE_ADMOB_REWARDED_ID':    JSON.stringify(process.env.VITE_ADMOB_REWARDED_ID || 'ca-app-pub-3940256099942544/5224354917'),
},
```

Also update the `test.define` block in the same file (the one inside `test: { ... }`):

```typescript
test: {
  environment: 'node',
  exclude: ['**/node_modules/**', '**/android/**', '**/dist/**'],
  define: {
    'import.meta.env.VITE_APP_VERSION':          JSON.stringify(pkg.version),
    'import.meta.env.VITE_AD_PROVIDER':          JSON.stringify('null'),
    'import.meta.env.VITE_ADMOB_INTERSTITIAL_ID': JSON.stringify('ca-app-pub-3940256099942544/1033173712'),
    'import.meta.env.VITE_ADMOB_REWARDED_ID':    JSON.stringify('ca-app-pub-3940256099942544/5224354917'),
  },
},
```

> Note: `ca-app-pub-3940256099942544/1033173712` and `ca-app-pub-3940256099942544/5224354917` are Google's official test ad unit IDs that always return test ads. Replace with your real ad unit IDs before shipping to production.

- [ ] **Step 3: Add build:android script to package.json**

In `package.json`, in the `"scripts"` block, add after `"build": "tsc && vite build"`:

```json
"build:android": "VITE_AD_PROVIDER=admob tsc && vite build && cap sync",
```

- [ ] **Step 4: Run tests to verify nothing is broken**

```bash
npm test
```

Expected: all existing tests pass. The `VITE_AD_PROVIDER` define in the test config defaults to `'null'`, so `AdClient` uses `NullProvider` in all test environments.

- [ ] **Step 5: Verify default web build still works**

```bash
npm run build
```

Expected: build succeeds. No `admob` references in the output — `AdMobProvider` branch is tree-shaken.

- [ ] **Step 6: Commit**

```bash
git add src/systems/ads/AdClient.ts vite.config.ts package.json
git commit -m "feat(ads): AdClient singleton, Vite defines, build:android script"
```

---

## Task 5: Android AdMob Configuration

**Files:**
- Modify: `android/app/src/main/AndroidManifest.xml`
- Modify: `android/app/src/main/res/values/strings.xml`

- [ ] **Step 1: Add admob_app_id string resource**

In `android/app/src/main/res/values/strings.xml`, add inside `<resources>`:

```xml
<string name="admob_app_id">ca-app-pub-3940256099942544~3347511713</string>
```

> `ca-app-pub-3940256099942544~3347511713` is Google's official test AdMob App ID. **Replace with your real AdMob App ID from the AdMob console before shipping to production.** The format is `ca-app-pub-XXXXXXXXXXXXXXXX~XXXXXXXXXX`.

After editing, `strings.xml` should look like:

```xml
<?xml version='1.0' encoding='utf-8'?>
<resources>
    <string name="app_name">Heap</string>
    <string name="title_activity_main">Heap</string>
    <string name="package_name">com.hanlinsoftware.heapgame.app</string>
    <string name="custom_url_scheme">com.hanlinsoftware.heapgame.app</string>
    <string name="admob_app_id">ca-app-pub-3940256099942544~3347511713</string>
</resources>
```

- [ ] **Step 2: Add AdMob meta-data to AndroidManifest.xml**

In `android/app/src/main/AndroidManifest.xml`, add this line after the existing `com.google.android.gms.games.APP_ID` meta-data (inside `<application>`):

```xml
<meta-data
    android:name="com.google.android.gms.ads.APPLICATION_ID"
    android:value="@string/admob_app_id"/>
```

After editing, the `<application>` block should start with:

```xml
<application
    android:allowBackup="true"
    android:icon="@mipmap/ic_launcher"
    android:label="@string/app_name"
    android:roundIcon="@mipmap/ic_launcher_round"
    android:supportsRtl="true"
    android:theme="@style/AppTheme">
    <meta-data android:name="com.google.android.gms.games.APP_ID" android:value="@string/app_id" />
    <meta-data
        android:name="com.google.android.gms.ads.APPLICATION_ID"
        android:value="@string/admob_app_id"/>
```

- [ ] **Step 3: Commit**

```bash
git add android/app/src/main/AndroidManifest.xml android/app/src/main/res/values/strings.xml
git commit -m "feat(ads): add AdMob App ID to Android manifest and strings"
```

---

## Task 6: BootScene — Initialize AdClient

**Files:**
- Modify: `src/scenes/BootScene.ts`

- [ ] **Step 1: Add AdClient import and initialize call**

In `src/scenes/BootScene.ts`, add the import after the existing imports:

```typescript
import { AdClient } from '../systems/ads/AdClient';
```

In `create()`, add the initialization call immediately after `AudioManager.init(this.sound)` (line ~29):

```typescript
AudioManager.init(this.sound);
AdClient.initialize().catch(() => { /* silent — ad init is optional */ });
```

The full block around this spot should look like:

```typescript
create(): void {
  generateAllTextures(this);
  AudioManager.init(this.sound);
  AdClient.initialize().catch(() => { /* silent — ad init is optional */ });

  // Default registry state so MenuScene can render before catalog resolves.
  this.game.registry.set('heapCatalog', [] as HeapSummary[]);
  // ... rest of create() unchanged
```

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: all tests pass. BootScene is not unit-tested but the import compiles.

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/scenes/BootScene.ts
git commit -m "feat(ads): initialize AdClient in BootScene"
```

---

## Task 7: ScoreScene — Interstitial Between Runs

**Files:**
- Modify: `src/scenes/ScoreScene.ts`

- [ ] **Step 1: Add AdClient import**

In `src/scenes/ScoreScene.ts`, add to the imports section:

```typescript
import { AdClient } from '../systems/ads/AdClient';
```

- [ ] **Step 2: Fire interstitial at the start of create()**

In `ScoreScene.create()`, add as the very first line of the method (before `AudioManager.play('music-score')`):

```typescript
create(): void {
  AdClient.showInterstitial(); // fire-and-forget; native overlay, non-blocking
  AudioManager.play('music-score');
  // ... rest of create() unchanged
```

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Verify build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/scenes/ScoreScene.ts
git commit -m "feat(ads): show interstitial between runs in ScoreScene"
```

---

## Task 8: ScoreScene — Rewarded "2× Coins" Button

**Files:**
- Modify: `src/scenes/ScoreScene.ts`

This task adds a button below the coins panel. Tapping it shows a rewarded ad; if the user watches to completion, the coins from that run are doubled.

- [ ] **Step 1: Add instance fields for rewarded button state**

In `ScoreScene`, add two new private fields after the existing `_breakdownObjects` field (around line 37–39):

```typescript
private _rewardedUsed:   boolean                        = false;
private _balanceText:    Phaser.GameObjects.Text | null = null;
private _finalCoins:     number                         = 0;
```

- [ ] **Step 2: Store finalCoins and balanceText reference**

In `create()`, after the coins are awarded and `result` is computed, store `_finalCoins`:

```typescript
if (!this._coinsAwarded) {
  this._coinsAwarded = true;
  addBalance(result.finalCoins);
}
this._finalCoins = result.finalCoins;
const balance = getBalance();
```

In `createCoinsPanel()`, after `balVal` is created (around line 629), add:

```typescript
const balVal = this.add.text(balRight, 0, `${balance} coins`, {
  fontSize: '12px', fontFamily: 'monospace', color: coinColor, fontStyle: 'bold',
}).setOrigin(1, 0.5);
this._balanceText = balVal; // expose for rewarded button update
```

- [ ] **Step 3: Add createRewardedAdButton private method**

Add this method to ScoreScene, after `createCoinsPanel`:

```typescript
private createRewardedAdButton(panelBottom: number): void {
  if (this._rewardedUsed) return;

  const cx  = this.scale.width  / 2;
  const btn = this.add.container(cx, panelBottom + 18);

  const bg = this.add.graphics();
  const W = 220, H = 36;
  bg.fillStyle(0xffcc00, 0.15);
  bg.lineStyle(1, 0xffcc00, 0.5);
  bg.fillRoundedRect(-W / 2, -H / 2, W, H, 8);
  bg.strokeRoundedRect(-W / 2, -H / 2, W, H, 8);

  const label = this.add.text(0, 0, '▶  Watch ad → 2× coins', {
    fontSize: '13px',
    fontFamily: 'monospace',
    color: '#ffdd66',
  }).setOrigin(0.5);

  btn.add([bg, label]);
  btn.setSize(W, H);
  btn.setInteractive({ cursor: 'pointer' });
  btn.setAlpha(0);

  this.time.delayedCall(1500, () => {
    this.tweens.add({ targets: btn, alpha: 1, duration: 300, ease: 'Cubic.Out' });
  });

  btn.on('pointerdown', async () => {
    if (this._rewardedUsed) return;
    this._rewardedUsed = true;
    btn.disableInteractive();
    label.setText('Loading ad…');

    const watched = await AdClient.showRewarded();
    if (watched) {
      addBalance(this._finalCoins);
      const newBalance = getBalance();
      this._balanceText?.setText(`${newBalance} coins`);
      label.setText('2× coins awarded!');
      this.time.delayedCall(1200, () => this.tweens.add({ targets: btn, alpha: 0, duration: 300 }));
    } else {
      this.tweens.add({ targets: btn, alpha: 0, duration: 200 });
    }
  });
}
```

- [ ] **Step 4: Call createRewardedAdButton from create()**

In `create()`, add the call after `createCoinsPanel` returns its bottom Y:

```typescript
const coinsPanelBottom = this.createCoinsPanel(result.rows, result.finalCoins, balance);
this.createRewardedAdButton(coinsPanelBottom);
this.createLeaderboardPanel(coinsPanelBottom);
```

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: all tests pass. ScoreScene is not directly unit-tested here — verify via scene-preview in Step 6.

- [ ] **Step 6: Smoke-test the rewarded button with scene-preview**

In Terminal 1 (keep running):
```bash
npm run dev
```

In Terminal 2:
```bash
npm run scene-preview -- ScoreScene '{"score":5000,"isFailure":false}' pixel7
```

Open `screenshots/preview.png`. Verify:
- Score scene renders correctly
- No visual regressions in the coins panel
- The "Watch ad → 2× coins" button is visible below the coins panel

Also test the failure case:
```bash
npm run scene-preview -- ScoreScene '{"score":2000,"isFailure":true}' pixel7
```

- [ ] **Step 7: Verify build**

```bash
npm run build
```

Expected: build succeeds, no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add src/scenes/ScoreScene.ts
git commit -m "feat(ads): rewarded 2x coins button in ScoreScene"
```

---

## Task 9: CI Workflow Update

**Files:**
- Modify: `.github/workflows/mobile.yml`

- [ ] **Step 1: Update build command and add env vars**

In `.github/workflows/mobile.yml`, find these two lines (around lines 27–30):

```yaml
      - run: npm run build
        env:
          VITE_HEAP_SERVER_URL: ${{ secrets.VITE_HEAP_SERVER_URL }}
      - run: npx cap sync android
```

Replace them with a single step that uses `build:android` (which already runs `cap sync`):

```yaml
      - run: npm run build:android
        env:
          VITE_HEAP_SERVER_URL: ${{ secrets.VITE_HEAP_SERVER_URL }}
          VITE_AD_PROVIDER: admob
          VITE_ADMOB_INTERSTITIAL_ID: ${{ secrets.VITE_ADMOB_INTERSTITIAL_ID }}
          VITE_ADMOB_REWARDED_ID: ${{ secrets.VITE_ADMOB_REWARDED_ID }}
```

> Before this CI change takes effect in production, add `VITE_ADMOB_INTERSTITIAL_ID` and `VITE_ADMOB_REWARDED_ID` as GitHub Actions secrets in the repo settings (Settings → Secrets and variables → Actions). Values come from your AdMob console ad units.

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/mobile.yml
git commit -m "ci: use build:android with AdMob env vars in mobile workflow"
```

---

## Task 10: Final Verification

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: all tests pass (count should be similar to baseline — no regressions).

- [ ] **Step 2: Verify default web build (NullProvider)**

```bash
npm run build
```

Expected: build succeeds. The output bundle should NOT contain any AdMob references.

Spot-check:
```bash
grep -r "admob\|AdMob" dist/ 2>/dev/null | grep -v ".map" | head
```

Expected: no matches (AdMobProvider tree-shaken out).

- [ ] **Step 3: Verify Android build compiles (AdMobProvider)**

```bash
VITE_AD_PROVIDER=admob npm run build
```

Expected: build succeeds. The `AdMobProvider` branch is included.

Spot-check:
```bash
grep -r "admob\|AdMob" dist/ 2>/dev/null | grep -v ".map" | head -5
```

Expected: matches present (AdMobProvider included in bundle).

- [ ] **Step 4: Final commit if any loose changes**

```bash
git status
```

If any untracked files, stage and commit them. Otherwise, the feature is ready to open a PR.

---

## Post-Ship Checklist (manual steps after merging)

1. In **AdMob console**: create the Android app, create interstitial and rewarded ad units, copy their IDs
2. Add real ad unit IDs to GitHub Actions secrets: `VITE_ADMOB_INTERSTITIAL_ID`, `VITE_ADMOB_REWARDED_ID`
3. In `android/app/src/main/res/values/strings.xml`: replace test App ID with real AdMob App ID
4. In **Play Console → App content → Advertising ID**: change declaration from **No → Yes**
5. Test on a physical device with a debug APK using `build:android`
