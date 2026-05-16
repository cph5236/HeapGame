# Gradle Play Publisher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate AAB + mapping.txt delivery to Google Play Console internal testing track on every push to `main` using Gradle Play Publisher (GPP), eliminating the manual download/upload step.

**Architecture:** GPP is a Gradle plugin that adds a `publishReleaseBundle` task — it builds the signed AAB, uploads it to the configured Play Console track, and uploads the mapping file automatically. Store listing metadata (text + screenshots) lives in `android/app/src/main/play/` and is pushed alongside each release. Service account credentials are passed via `ANDROID_PUBLISHER_CREDENTIALS` env var in CI — never written to a file.

**Tech Stack:** Gradle Play Publisher 4.0.0, GitHub Actions, R8/ProGuard, Google Play Developer API.

---

## Files Touched

| File | Action |
|---|---|
| `android/build.gradle` | Add GPP classpath |
| `android/app/build.gradle` | Apply GPP plugin, add `play {}` block, enable R8 |
| `android/app/src/main/play/listings/en-US/title.txt` | Create |
| `android/app/src/main/play/listings/en-US/short-description.txt` | Create |
| `android/app/src/main/play/listings/en-US/full-description.txt` | Create |
| `android/app/src/main/play/listings/en-US/graphics/feature-graphic/1.png` | Create (moved) |
| `android/app/src/main/play/listings/en-US/graphics/icon/1.png` | Create (moved) |
| `android/app/src/main/play/listings/en-US/graphics/phone-screenshots/1.png` | Create (moved) |
| `android/app/src/main/play/listings/en-US/graphics/phone-screenshots/2.png` | Create (moved) |
| `android/app/src/main/play/listings/en-US/graphics/tablet-10-inch-screenshots/1.png` | Create (moved) |
| `android/app/src/main/play/listings/en-US/graphics/tablet-10-inch-screenshots/2.png` | Create (moved) |
| `android/app/src/main/play/listings/en-US/graphics/tablet-7-inch-screenshots/1.png` | Create (moved) |
| `android/app/src/main/play/listings/en-US/graphics/tablet-7-inch-screenshots/2.png` | Create (moved) |
| `android/app/src/main/play/release-notes/en-US/internal.txt` | Create |
| `StorelistingScreenshots/` | Delete entire folder |
| `.github/workflows/mobile.yml` | Replace `bundleRelease` + artifact upload with `publishReleaseBundle` |

---

## Task 1: Add GPP classpath to root build.gradle

**Files:**
- Modify: `android/build.gradle`

- [ ] **Step 1: Add the GPP classpath dependency**

Open `android/build.gradle`. The current `dependencies` block inside `buildscript` is:

```groovy
dependencies {
    classpath 'com.android.tools.build:gradle:8.13.0'
    classpath 'com.google.gms:google-services:4.4.4'

    // NOTE: Do not place your application dependencies here; they belong
    // in the individual module build.gradle files
}
```

Replace it with:

```groovy
dependencies {
    classpath 'com.android.tools.build:gradle:8.13.0'
    classpath 'com.google.gms:google-services:4.4.4'
    classpath 'com.github.triplet.gradle:play-publisher:4.0.0'

    // NOTE: Do not place your application dependencies here; they belong
    // in the individual module build.gradle files
}
```

- [ ] **Step 2: Commit**

```bash
git add android/build.gradle
git commit -m "build: add Gradle Play Publisher 4.0.0 classpath"
```

---

## Task 2: Apply GPP plugin and enable R8 in app/build.gradle

**Files:**
- Modify: `android/app/build.gradle`

- [ ] **Step 1: Apply the GPP plugin**

At the top of `android/app/build.gradle`, after the existing `apply plugin: 'com.android.application'` line, add:

```groovy
apply plugin: 'com.android.application'
apply plugin: 'com.github.triplet.play'
```

- [ ] **Step 2: Enable R8 and update ProGuard file reference**

Find the `buildTypes` block:

```groovy
buildTypes {
    release {
        minifyEnabled false
        proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
    }
}
```

Replace it with:

```groovy
buildTypes {
    release {
        minifyEnabled true
        proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
    }
}
```

Note: `proguard-android-optimize.txt` is the more aggressive default that also enables optimizations. Capacitor's AAR bundles its own consumer ProGuard rules that keep the WebView bridge intact — no explicit `-keep` rules needed in `proguard-rules.pro` unless crash traces later show broken bridge classes.

- [ ] **Step 3: Add the `play {}` configuration block**

At the end of `android/app/build.gradle`, before the `try { ... }` block for google-services, add:

```groovy
play {
    track.set("internal")
    defaultToAppBundles.set(true)
    // Credentials are read from ANDROID_PUBLISHER_CREDENTIALS env var in CI.
    // To run publishReleaseBundle locally, export that env var with the service account JSON.
}
```

The full end of the file should look like:

```groovy
apply from: 'capacitor.build.gradle'

play {
    track.set("internal")
    defaultToAppBundles.set(true)
    // Credentials are read from ANDROID_PUBLISHER_CREDENTIALS env var in CI.
    // To run publishReleaseBundle locally, export that env var with the service account JSON.
}

try {
    def servicesJSON = file('google-services.json')
    if (servicesJSON.text) {
        apply plugin: 'com.google.gms.google-services'
    }
} catch(Exception e) {
    logger.info("google-services.json not found, google-services plugin not applied. Push Notifications won't work")
}
```

- [ ] **Step 4: Commit**

```bash
git add android/app/build.gradle
git commit -m "build: apply GPP plugin, enable R8, configure internal track"
```

---

## Task 3: Create store listing text files

**Files:**
- Create: `android/app/src/main/play/listings/en-US/title.txt`
- Create: `android/app/src/main/play/listings/en-US/short-description.txt`
- Create: `android/app/src/main/play/listings/en-US/full-description.txt`
- Create: `android/app/src/main/play/release-notes/en-US/internal.txt`

- [ ] **Step 1: Create the directory structure**

```bash
mkdir -p android/app/src/main/play/listings/en-US/graphics/feature-graphic
mkdir -p android/app/src/main/play/listings/en-US/graphics/icon
mkdir -p android/app/src/main/play/listings/en-US/graphics/phone-screenshots
mkdir -p android/app/src/main/play/listings/en-US/graphics/tablet-10-inch-screenshots
mkdir -p android/app/src/main/play/listings/en-US/graphics/tablet-7-inch-screenshots
mkdir -p android/app/src/main/play/release-notes/en-US
```

- [ ] **Step 2: Create `title.txt`** (max 50 chars)

`android/app/src/main/play/listings/en-US/title.txt`:
```
Heap
```

- [ ] **Step 3: Create `short-description.txt`** (max 80 chars)

`android/app/src/main/play/listings/en-US/short-description.txt`:
```
A community-grown vertical climbing platformer. Build the heap. Climb higher.
```

- [ ] **Step 4: Create `full-description.txt`** (max 4000 chars)

`android/app/src/main/play/listings/en-US/full-description.txt`:
```
Heap is a mobile-first 2D vertical climbing platformer where every run is shaped by the community.

Climb a towering heap of trash, placed piece by piece by players like you. Every item you place becomes part of the permanent landscape — bridges, ladders, checkpoints — making the climb easier (or harder) for everyone who comes after.

Features:
• Vertical climbing platformer with tight, responsive controls
• Community-built levels — the heap grows with every player
• Place items to help future climbers
• Enemies, upgrades, and score multipliers
• Google Play Games integration — achievements and leaderboards
• Cloud saves — pick up where you left off on any device
```

- [ ] **Step 5: Create `internal.txt`** (release notes shown to internal testers)

`android/app/src/main/play/release-notes/en-US/internal.txt`:
```
Internal build. See git log for changes.
```

- [ ] **Step 6: Commit**

```bash
git add android/app/src/main/play/listings/en-US/title.txt
git add android/app/src/main/play/listings/en-US/short-description.txt
git add android/app/src/main/play/listings/en-US/full-description.txt
git add android/app/src/main/play/release-notes/en-US/internal.txt
git commit -m "build: add GPP store listing text files"
```

---

## Task 4: Migrate screenshots into play/ folder

**Files:**
- Create: all PNG files under `android/app/src/main/play/listings/en-US/graphics/`
- Delete: `StorelistingScreenshots/`

GPP requires screenshots to be named `1.png`, `2.png`, etc. within their respective subdirectory.

- [ ] **Step 1: Copy and rename all screenshots**

```bash
cp StorelistingScreenshots/feature_graphic.png \
   android/app/src/main/play/listings/en-US/graphics/feature-graphic/1.png

cp StorelistingScreenshots/Icon/Store_Icon.png \
   android/app/src/main/play/listings/en-US/graphics/icon/1.png

cp StorelistingScreenshots/phone/MainMenu.png \
   android/app/src/main/play/listings/en-US/graphics/phone-screenshots/1.png

cp StorelistingScreenshots/phone/ScoreScene.png \
   android/app/src/main/play/listings/en-US/graphics/phone-screenshots/2.png

cp StorelistingScreenshots/tablet10/MainMenu.png \
   android/app/src/main/play/listings/en-US/graphics/tablet-10-inch-screenshots/1.png

cp StorelistingScreenshots/tablet10/ScoreScene.png \
   android/app/src/main/play/listings/en-US/graphics/tablet-10-inch-screenshots/2.png

cp StorelistingScreenshots/tablet7/MainMenu.png \
   android/app/src/main/play/listings/en-US/graphics/tablet-7-inch-screenshots/1.png

cp StorelistingScreenshots/tablet7/ScoreScene.png \
   android/app/src/main/play/listings/en-US/graphics/tablet-7-inch-screenshots/2.png
```

- [ ] **Step 2: Verify all 8 files landed correctly**

```bash
find android/app/src/main/play/listings/en-US/graphics -name "*.png" | sort
```

Expected output:
```
android/app/src/main/play/listings/en-US/graphics/feature-graphic/1.png
android/app/src/main/play/listings/en-US/graphics/icon/1.png
android/app/src/main/play/listings/en-US/graphics/phone-screenshots/1.png
android/app/src/main/play/listings/en-US/graphics/phone-screenshots/2.png
android/app/src/main/play/listings/en-US/graphics/tablet-10-inch-screenshots/1.png
android/app/src/main/play/listings/en-US/graphics/tablet-10-inch-screenshots/2.png
android/app/src/main/play/listings/en-US/graphics/tablet-7-inch-screenshots/1.png
android/app/src/main/play/listings/en-US/graphics/tablet-7-inch-screenshots/2.png
```

- [ ] **Step 3: Delete the old folder**

```bash
rm -rf StorelistingScreenshots/
```

- [ ] **Step 4: Commit**

```bash
git add android/app/src/main/play/listings/en-US/graphics/
git add -u StorelistingScreenshots/
git commit -m "build: migrate screenshots to GPP play/ folder, remove StorelistingScreenshots"
```

---

## Task 5: Update mobile.yml to use publishReleaseBundle

**Files:**
- Modify: `.github/workflows/mobile.yml`

- [ ] **Step 1: Replace the push path**

Find and replace the entire push-path section (from `Decode keystore` through the end of `upload-artifact`):

**Current:**
```yaml
      # ---- Push / workflow_dispatch path: signed AAB for Play Console ----
      - name: Decode keystore
        if: github.event_name != 'pull_request'
        run: echo "${{ secrets.ANDROID_KEYSTORE_BASE64 }}" | base64 -d > android/app/release.keystore

      - name: Build AAB
        if: github.event_name != 'pull_request'
        working-directory: android
        run: |
          ./gradlew bundleRelease \
            -Pandroid.injected.signing.store.file=${{ github.workspace }}/android/app/release.keystore \
            -Pandroid.injected.signing.store.password=${{ secrets.ANDROID_KEYSTORE_PASSWORD }} \
            -Pandroid.injected.signing.key.alias=${{ secrets.ANDROID_KEY_ALIAS }} \
            -Pandroid.injected.signing.key.password=${{ secrets.ANDROID_KEY_PASSWORD }}

      - uses: actions/upload-artifact@v4
        if: github.event_name != 'pull_request'
        with:
          name: android-aab
          path: |
            android/app/build/outputs/bundle/release/app-release.aab
            android/app/build/outputs/mapping/release/mapping.txt
```

**Replace with:**
```yaml
      # ---- Push / workflow_dispatch path: publish signed AAB to Play Console ----
      - name: Decode keystore
        if: github.event_name != 'pull_request'
        run: echo "${{ secrets.ANDROID_KEYSTORE_BASE64 }}" | base64 -d > android/app/release.keystore

      - name: Publish to Play Console (internal track)
        if: github.event_name != 'pull_request'
        working-directory: android
        env:
          ANDROID_PUBLISHER_CREDENTIALS: ${{ secrets.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON }}
        run: |
          ./gradlew publishReleaseBundle \
            -Pandroid.injected.signing.store.file=${{ github.workspace }}/android/app/release.keystore \
            -Pandroid.injected.signing.store.password=${{ secrets.ANDROID_KEYSTORE_PASSWORD }} \
            -Pandroid.injected.signing.key.alias=${{ secrets.ANDROID_KEY_ALIAS }} \
            -Pandroid.injected.signing.key.password=${{ secrets.ANDROID_KEY_PASSWORD }}
```

- [ ] **Step 2: Verify the PR path is unchanged**

The PR step should still read exactly:
```yaml
      # ---- PR path: unsigned verify build only (no secrets, no AAB upload) ----
      - name: Build (PR — unsigned verify)
        if: github.event_name == 'pull_request'
        working-directory: android
        run: ./gradlew assembleDebug
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/mobile.yml
git commit -m "ci: publish AAB to Play Console via GPP, remove manual artifact upload"
```

---

## Task 6: Trigger CI and verify

There are no unit tests for this change — verification is the CI run itself.

- [ ] **Step 1: Bump versionCode before pushing**

GPP will reject an upload if the `versionCode` already exists in Play Console. Open `android/app/build.gradle` and increment `versionCode`:

```groovy
versionCode 7          // was 6
versionName "0.1.6"    // bump as appropriate
```

- [ ] **Step 2: Commit the version bump**

```bash
git add android/app/build.gradle
git commit -m "chore: bump versionCode to 7 for GPP release"
```

- [ ] **Step 3: Push and watch CI**

```bash
git push
```

Go to the repo's **Actions** tab and watch the `Mobile Builds` run. Expected flow:
1. `npm ci` + `npm run build` + `npx cap sync android` — passes
2. `Build (PR — unsigned verify)` — skipped (push, not PR)
3. `Decode keystore` — runs
4. `Publish to Play Console (internal track)` — runs, should take 2–5 minutes to build + upload

- [ ] **Step 4: Confirm in Play Console**

Go to Play Console → Heap → **Testing → Internal testing**. The new version should appear as a draft or available release within a few minutes of CI completing.

- [ ] **Step 5: Check mapping file was uploaded**

In Play Console, go to the release detail for the new version. Under **App bundles**, click the arrow next to the bundle — you should see the mapping file listed. The "no deobfuscation file" warning should be gone.

---

## Troubleshooting

**`publishReleaseBundle` fails with "Version code already exists"**
Increment `versionCode` in `android/app/build.gradle` and push again.

**`publishReleaseBundle` fails with "The caller does not have permission"**
The service account wasn't granted the right permissions in Play Console. Go to Play Console → Users and permissions → find the service account email → ensure it has **Release to testing tracks** permission.

**`publishReleaseBundle` fails with "credentials not found"**
The `ANDROID_PUBLISHER_CREDENTIALS` env var isn't being read. Double-check the secret name in GitHub is exactly `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` and the `env:` block in the workflow step spells it correctly.

**R8 breaks the app (Capacitor bridge stops working)**
Add explicit keep rules to `android/app/proguard-rules.pro`:
```
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
```
Then rebuild and retest.
