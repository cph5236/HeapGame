# Gradle Play Publisher Setup — Design Spec

**Date:** 2026-05-15
**Goal:** Automate AAB + mapping.txt delivery to Google Play Console internal testing track on every push to `main`, using Gradle Play Publisher (GPP). Eliminate manual AAB download/upload step.

---

## What Changes

| Area | Change |
|---|---|
| `android/build.gradle` | Add GPP classpath dependency |
| `android/app/build.gradle` | Apply GPP plugin, add `play {}` config block, enable R8 |
| `android/app/src/main/play/` | New GPP metadata folder (store listing text + screenshots) |
| `StorelistingScreenshots/` | Deleted — content moved into `play/` in GPP format |
| `.github/workflows/mobile.yml` | Replace `bundleRelease` + artifact upload with `publishReleaseBundle` |
| GitHub Secrets | `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` — already added |

---

## Build Config

### `android/build.gradle` — add GPP classpath

```groovy
buildscript {
    dependencies {
        // existing entries...
        classpath 'com.github.triplet.gradle:play-publisher:4.0.0'
    }
}
```

### `android/app/build.gradle` — apply plugin + configure

```groovy
apply plugin: 'com.github.triplet.play'

android {
    buildTypes {
        release {
            minifyEnabled true   // was false — enables R8 + mapping.txt generation
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
}

play {
    track.set("internal")
    defaultToAppBundles.set(true)
    // serviceAccountCredentials read from ANDROID_PUBLISHER_CREDENTIALS env var in CI
}
```

R8 is enabled here alongside GPP — without it, no `mapping.txt` is generated and the Play Console warning persists.

**Proguard rules note:** `proguard-android-optimize.txt` replaces the current `proguard-android.txt` for better optimization. The game JS runs in a WebView and is untouched by R8. Capacitor's AAR bundles its own consumer ProGuard rules that keep the WebView bridge intact. `proguard-rules.pro` remains empty for now — add explicit `-keep` rules only if crash traces show broken Capacitor bridge classes after testing.

---

## CI Changes (`mobile.yml`)

The push path changes from `bundleRelease` + manual artifact upload to a single `publishReleaseBundle` call. GPP builds the AAB, uploads it to the internal track, and uploads the mapping file automatically.

**Before (push path):**
```yaml
- name: Build AAB
  run: ./gradlew bundleRelease ...signing flags...

- uses: actions/upload-artifact@v4
  with:
    path: |
      .../app-release.aab
      .../mapping.txt
```

**After (push path):**
```yaml
- name: Publish to Play Console (internal track)
  working-directory: android
  env:
    ANDROID_PUBLISHER_CREDENTIALS: ${{ secrets.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON }}
  run: |
    ./gradlew publishReleaseBundle \
      -Pandroid.injected.signing.store.file=... \
      -Pandroid.injected.signing.store.password=... \
      -Pandroid.injected.signing.key.alias=... \
      -Pandroid.injected.signing.key.password=...
```

The service account JSON is passed via `ANDROID_PUBLISHER_CREDENTIALS` env var — GPP reads it automatically. The JSON never touches the filesystem or the repo.

The PR path (`assembleDebug`) is unchanged.

---

## Store Listing Structure (`play/`)

GPP reads store metadata from `android/app/src/main/play/`. On every `publishReleaseBundle` run, GPP pushes this content to Play Console alongside the AAB.

```
android/app/src/main/play/
  listings/
    en-US/
      title.txt                        ← "Heap" (max 50 chars)
      short-description.txt            ← max 80 chars
      full-description.txt             ← max 4000 chars
      graphics/
        feature-graphic/
          1.png                        ← from StorelistingScreenshots/feature_graphic.png
        icon/
          1.png                        ← from StorelistingScreenshots/Icon/Store_Icon.png
        phone-screenshots/
          1.png                        ← from StorelistingScreenshots/phone/MainMenu.png
          2.png                        ← from StorelistingScreenshots/phone/ScoreScene.png
        tablet-10-inch-screenshots/
          1.png                        ← from StorelistingScreenshots/tablet10/MainMenu.png
          2.png                        ← from StorelistingScreenshots/tablet10/ScoreScene.png
        tablet-7-inch-screenshots/
          1.png                        ← from StorelistingScreenshots/tablet7/MainMenu.png
          2.png                        ← from StorelistingScreenshots/tablet7/ScoreScene.png
  release-notes/
    en-US/
      internal.txt                     ← "What's new" shown to internal testers
```

`StorelistingScreenshots/` is deleted after migration — `play/` is the single source of truth going forward.

---

## What Does NOT Change

- `versionCode` and `versionName` in `build.gradle` — still bumped manually before each release commit
- PR path in CI — still runs `assembleDebug`, no Play Console interaction
- Game JS minification — handled by Vite, R8 does not touch WebView assets
- `.wrangler/`, server code, client game code — untouched

---

## Success Criteria

- Push to `main` triggers CI
- CI builds signed AAB, uploads it to internal testing track in Play Console
- Mapping file uploaded automatically alongside AAB
- Play Console "no deobfuscation file" warning cleared
- Store listing text and screenshots in Play Console match the `play/` folder content
- PR builds still pass without any Play Console interaction
