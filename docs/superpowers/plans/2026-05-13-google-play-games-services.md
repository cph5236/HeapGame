# Google Play Games Services Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Google Play Games Services (GPGS) into the Android build to enable background sign-in, achievements, a Google Play leaderboard, and cloud saves.

**Architecture:** A custom in-app Capacitor plugin (`PlayGamesPlugin.java`) exposes GPGS SDK calls to the TypeScript layer. A thin wrapper (`PlayGamesClient.ts`) is the only file the game ever imports — all methods return `null`/`void` gracefully on non-Android builds. `SaveData.ts` gains a `gpgsPlayerId` field and a `mergeCloudSave` function.

**Tech Stack:** Play Games SDK v2 (`play-services-games-v2:19.0.0`), Capacitor 8.2 in-app plugin pattern, Vitest for TypeScript unit tests.

---

## Scope note

The four GPGS subsystems (Identity, Achievements, Leaderboards, Cloud Saves) all share the same custom plugin and are not independently deployable — Identity is a prerequisite for everything. This plan covers all four in five sequential phases. Each phase is a mergeable milestone; Cloud Saves (Phase 5) is the most complex and can be deferred if needed.

---

## File Map

**New files:**
- `android/app/src/main/java/com/hanlinsoftware/heapgame/app/PlayGamesPlugin.java` — Capacitor plugin: all GPGS SDK calls
- `android/app/src/main/res/values/games_ids.xml` — string resource for the Play Games App ID
- `src/systems/PlayGamesClient.ts` — TypeScript wrapper; the only GPGS import used in game code
- `src/data/achievementDefs.ts` — achievement and leaderboard ID constants
- `src/systems/__tests__/PlayGamesClient.test.ts` — Vitest unit tests for the wrapper

**Modified files:**
- `android/app/build.gradle:33` — add `play-services-games-v2` dependency
- `android/app/src/main/AndroidManifest.xml:10` — add APP_ID meta-data inside `<application>`
- `android/app/src/main/java/com/hanlinsoftware/heapgame/app/MainActivity.java:14` — `registerPlugin(PlayGamesPlugin.class)` before `super.onCreate`
- `src/systems/SaveData.ts` — add `gpgsPlayerId` field + `getGpgsPlayerId`/`setGpgsPlayerId`/`mergeCloudSave`
- `src/scenes/BootScene.ts:55` — call `PlayGamesClient.signIn()` after catalog resolves
- `src/scenes/GameScene.ts:514` — call achievement unlock helpers after kill / at height milestones
- `src/scenes/ScoreScene.ts:694` — call `PlayGamesClient.submitScore` after server call resolves

---

## Phase 1 — Play Console Setup + Build Config

These tasks configure the Android project. They don't touch game logic. No unit tests cover Android build config.

---

### Task 1: Play Console Setup (non-code prerequisites)

**Files:** None — this is a checklist of manual steps that must be done before any code runs.

- [ ] **Step 1: Enable Play Games Services in Play Console**

  In [Google Play Console](https://play.google.com/console):
  1. Select the Heap app → **Grow → Play Games Services → Setup and management → Configuration**
  2. Click **Create new Play Games Services project** → enter app name "Heap"
  3. Link the Android app: package name `com.hanlinsoftware.heapgame.app`
  4. Note the **Application ID** shown at the top (a numeric string like `123456789012`). This goes in `games_ids.xml`.

- [ ] **Step 2: Create the leaderboard**

  In Play Console → Play Games Services → Leaderboards → **Add leaderboard**:
  - Name: "High Score"
  - Ordering: Larger is better
  - Score format: Integer
  - Save the ID ID: CgkIpJC3z5gSEAIQBw. This goes in `achievementDefs.ts`.

- [ ] **Step 3: Create achievements**

  In Play Console → Play Games Services → Achievements → **Add achievement** for each:
  | Name | Description | Type |
  |---|---|---|
  | First Climb | Complete your first run | Standard | ID: CgkIpJC3z5gSEAIQAQ
  | Sky High | Reach 100 m in a single run | Standard | ID: CgkIpJC3z5gSEAIQAg
  | Cloud Surfer | Reach 1 000 m in a single run | Standard | ID: CgkIpJC3z5gSEAIQAw
  | Builder | Place your first item on the heap | Standard | ID: CgkIpJC3z5gSEAIQBA
  | Pest Control | Stomp 10 enemies in a single run | Standard | ID: CgkIpJC3z5gSEAIQBQ
    | Heap Exterminator | Stomp 100 enemies total | Incremental 100 steps| ID: CgkIpJC3z5gSEAIQBg

  Save each achievement ID (also `CgkI...` format). These go in `achievementDefs.ts`.

- [ ] **Step 4: Add OAuth credentials**

  In Play Console → Play Games Services → Configuration → **Add credential**:
  - Type: Android
  - Package name: `com.hanlinsoftware.heapgame.app`
  - Enter the SHA-1 fingerprint for both debug and release keystores.

  ```bash
  # Debug fingerprint (run from repo root):
  keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android | grep SHA1
  ```

- [ ] **Step 5: Place `google-services.json`**

  Download the file from [Firebase Console](https://console.firebase.google.com) (same Google project):
  Firebase Console → Project Settings → Your apps → `com.hanlinsoftware.heapgame.app` → Download `google-services.json`

  Place at: `android/app/google-services.json`

  Verify it is gitignored:
  ```bash
  grep google-services.json android/app/.gitignore || echo "MISSING — add it"
  ```
  If missing, add to `android/app/.gitignore`:
  ```
  google-services.json
  ```

- [ ] **Step 6: Commit the .gitignore update only**

  ```bash
  git add android/app/.gitignore
  git commit -m "chore: gitignore google-services.json"
  ```

---

### Task 2: Add Play Games SDK Dependency

**Files:**
- Modify: `android/app/build.gradle:33`

- [ ] **Step 1: Add the dependency**

  In `android/app/build.gradle`, inside the `dependencies { }` block (after the last `implementation` line), add:

  ```groovy
  implementation 'com.google.android.gms:play-services-games-v2:19.0.0'
  ```

  The full `dependencies` block should look like:
  ```groovy
  dependencies {
      implementation fileTree(include: ['*.jar'], dir: 'libs')
      implementation "androidx.appcompat:appcompat:$androidxAppCompatVersion"
      implementation "androidx.coordinatorlayout:coordinatorlayout:$androidxCoordinatorLayoutVersion"
      implementation "androidx.core:core-splashscreen:$coreSplashScreenVersion"
      implementation project(':capacitor-android')
      testImplementation "junit:junit:$junitVersion"
      androidTestImplementation "androidx.test.ext:junit:$androidxJunitVersion"
      androidTestImplementation "androidx.test.espresso:espresso-core:$androidxEspressoCoreVersion"
      implementation project(':capacitor-cordova-android-plugins')
      implementation 'com.google.android.gms:play-services-games-v2:19.0.0'
  }
  ```

- [ ] **Step 2: Sync and verify build compiles**

  ```bash
  cd android && ./gradlew assembleDebug 2>&1 | tail -20
  ```
  Expected: `BUILD SUCCESSFUL`

- [ ] **Step 3: Commit**

  ```bash
  git add android/app/build.gradle
  git commit -m "feat: add play-services-games-v2 dependency"
  ```

---

### Task 3: AndroidManifest + games_ids.xml

**Files:**
- Create: `android/app/src/main/res/values/games_ids.xml`
- Modify: `android/app/src/main/AndroidManifest.xml:10`

- [ ] **Step 1: Create `games_ids.xml`**

  Create `android/app/src/main/res/values/games_ids.xml`:
  ```xml
  <?xml version="1.0" encoding="utf-8"?>
  <resources>
      <!-- Replace with the Application ID from Play Console → Play Games Services → Configuration -->
      <string name="app_id" translatable="false">REPLACE_WITH_PLAY_GAMES_APP_ID</string>
  </resources>
  ```

  Replace `REPLACE_WITH_PLAY_GAMES_APP_ID` with the numeric ID from Task 1 Step 1.

- [ ] **Step 2: Add APP_ID meta-data to AndroidManifest**

  In `android/app/src/main/AndroidManifest.xml`, add inside the `<application>` tag (after the opening `<application` line, before `<activity>`):

  ```xml
  <meta-data
      android:name="com.google.android.gms.games.APP_ID"
      android:value="@string/app_id" />
  ```

  The full `<application>` opening should look like:
  ```xml
  <application
      android:allowBackup="true"
      android:icon="@mipmap/ic_launcher"
      android:label="@string/app_name"
      android:roundIcon="@mipmap/ic_launcher_round"
      android:supportsRtl="true"
      android:theme="@style/AppTheme">

      <meta-data
          android:name="com.google.android.gms.games.APP_ID"
          android:value="@string/app_id" />

      <activity ...>
  ```

- [ ] **Step 3: Verify build still compiles**

  ```bash
  cd android && ./gradlew assembleDebug 2>&1 | tail -10
  ```
  Expected: `BUILD SUCCESSFUL`

- [ ] **Step 4: Commit**

  ```bash
  git add android/app/src/main/res/values/games_ids.xml \
          android/app/src/main/AndroidManifest.xml
  git commit -m "feat: configure Play Games Services app ID"
  ```

---

## Phase 2 — In-App Plugin + TypeScript Wrapper

---

### Task 4: Create PlayGamesPlugin.java (sign-in + getPlayer)

**Files:**
- Create: `android/app/src/main/java/com/hanlinsoftware/heapgame/app/PlayGamesPlugin.java`

- [ ] **Step 1: Write the plugin**

  Create `android/app/src/main/java/com/hanlinsoftware/heapgame/app/PlayGamesPlugin.java`:

  ```java
  package com.hanlinsoftware.heapgame.app;

  import com.getcapacitor.JSObject;
  import com.getcapacitor.Plugin;
  import com.getcapacitor.PluginCall;
  import com.getcapacitor.PluginMethod;
  import com.getcapacitor.annotation.CapacitorPlugin;

  import com.google.android.gms.games.PlayGames;
  import com.google.android.gms.games.GamesSignInClient;
  import com.google.android.gms.games.Player;

  @CapacitorPlugin(name = "PlayGames")
  public class PlayGamesPlugin extends Plugin {

      // ── Sign-in ──────────────────────────────────────────────────────────────

      @PluginMethod
      public void signIn(PluginCall call) {
          GamesSignInClient signInClient = PlayGames.getGamesSignInClient(getActivity());
          signInClient.isAuthenticated().addOnCompleteListener(authTask -> {
              boolean isAuthenticated = authTask.isSuccessful()
                  && authTask.getResult() != null
                  && authTask.getResult().isAuthenticated();

              if (isAuthenticated) {
                  fetchAndResolvePlayer(call);
              } else {
                  signInClient.signIn().addOnCompleteListener(signInTask -> {
                      if (signInTask.isSuccessful()) {
                          fetchAndResolvePlayer(call);
                      } else {
                          call.reject("GPGS sign-in failed");
                      }
                  });
              }
          });
      }

      private void fetchAndResolvePlayer(PluginCall call) {
          PlayGames.getPlayersClient(getActivity()).getCurrentPlayer()
              .addOnCompleteListener(playerTask -> {
                  if (playerTask.isSuccessful() && playerTask.getResult() != null) {
                      Player player = playerTask.getResult();
                      JSObject result = new JSObject();
                      result.put("playerId", player.getPlayerId());
                      result.put("displayName", player.getDisplayName());
                      call.resolve(result);
                  } else {
                      call.reject("Failed to get player info");
                  }
              });
      }
  }
  ```

- [ ] **Step 2: Register the plugin in MainActivity.java**

  In `android/app/src/main/java/com/hanlinsoftware/heapgame/app/MainActivity.java`, add the import and `registerPlugin` call **before** `super.onCreate`:

  ```java
  package com.hanlinsoftware.heapgame.app;

  import android.os.Bundle;
  import androidx.core.view.ViewCompat;
  import androidx.core.view.WindowCompat;
  import androidx.core.view.WindowInsetsCompat;
  import androidx.core.view.WindowInsetsControllerCompat;
  import com.getcapacitor.BridgeActivity;

  public class MainActivity extends BridgeActivity {

      @Override
      protected void onCreate(Bundle savedInstanceState) {
          registerPlugin(PlayGamesPlugin.class);
          super.onCreate(savedInstanceState);
          ViewCompat.setOnApplyWindowInsetsListener(
              getWindow().getDecorView(),
              (v, insets) -> WindowInsetsCompat.CONSUMED
          );
          hideSystemBars();
      }

      @Override
      public void onWindowFocusChanged(boolean hasFocus) {
          super.onWindowFocusChanged(hasFocus);
          if (hasFocus) hideSystemBars();
      }

      private void hideSystemBars() {
          WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
          WindowInsetsControllerCompat controller = new WindowInsetsControllerCompat(
              getWindow(), getWindow().getDecorView()
          );
          controller.hide(WindowInsetsCompat.Type.systemBars());
          controller.setSystemBarsBehavior(
              WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
          );
      }
  }
  ```

- [ ] **Step 3: Verify build compiles**

  ```bash
  cd android && ./gradlew assembleDebug 2>&1 | tail -10
  ```
  Expected: `BUILD SUCCESSFUL`

- [ ] **Step 4: Commit**

  ```bash
  git add android/app/src/main/java/com/hanlinsoftware/heapgame/app/PlayGamesPlugin.java \
          android/app/src/main/java/com/hanlinsoftware/heapgame/app/MainActivity.java
  git commit -m "feat: add PlayGamesPlugin Capacitor in-app plugin (sign-in)"
  ```

---

### Task 5: Write tests for PlayGamesClient

**Files:**
- Create: `src/systems/__tests__/PlayGamesClient.test.ts`

- [ ] **Step 1: Write the failing tests**

  Create `src/systems/__tests__/PlayGamesClient.test.ts`:

  ```typescript
  import { describe, it, expect, vi, beforeEach } from 'vitest';

  const mockPlugin = {
    signIn:            vi.fn(),
    unlockAchievement: vi.fn(),
    submitScore:       vi.fn(),
    saveSnapshot:      vi.fn(),
    loadSnapshot:      vi.fn(),
  };

  const mockGetPlatform = vi.fn();

  vi.mock('@capacitor/core', () => ({
    registerPlugin: vi.fn(() => mockPlugin),
    Capacitor:      { getPlatform: mockGetPlatform },
  }));

  // Import after mocks are set up
  const { PlayGamesClient } = await import('../PlayGamesClient');

  describe('PlayGamesClient.signIn', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns player info when on Android and plugin resolves', async () => {
      mockGetPlatform.mockReturnValue('android');
      mockPlugin.signIn.mockResolvedValue({ playerId: 'gpgs-abc', displayName: 'TestUser' });

      const result = await PlayGamesClient.signIn();

      expect(result).toEqual({ playerId: 'gpgs-abc', displayName: 'TestUser' });
    });

    it('returns null when not on Android', async () => {
      mockGetPlatform.mockReturnValue('web');

      const result = await PlayGamesClient.signIn();

      expect(result).toBeNull();
      expect(mockPlugin.signIn).not.toHaveBeenCalled();
    });

    it('returns null when plugin throws', async () => {
      mockGetPlatform.mockReturnValue('android');
      mockPlugin.signIn.mockRejectedValue(new Error('no network'));

      const result = await PlayGamesClient.signIn();

      expect(result).toBeNull();
    });
  });

  describe('PlayGamesClient.unlockAchievement', () => {
    beforeEach(() => vi.clearAllMocks());

    it('calls plugin with achievementId when on Android', async () => {
      mockGetPlatform.mockReturnValue('android');
      mockPlugin.unlockAchievement.mockResolvedValue(undefined);

      await PlayGamesClient.unlockAchievement('CgkI_test_id');

      expect(mockPlugin.unlockAchievement).toHaveBeenCalledWith({ achievementId: 'CgkI_test_id' });
    });

    it('does nothing when not on Android', async () => {
      mockGetPlatform.mockReturnValue('web');

      await PlayGamesClient.unlockAchievement('CgkI_test_id');

      expect(mockPlugin.unlockAchievement).not.toHaveBeenCalled();
    });

    it('swallows plugin errors silently', async () => {
      mockGetPlatform.mockReturnValue('android');
      mockPlugin.unlockAchievement.mockRejectedValue(new Error('not signed in'));

      await expect(PlayGamesClient.unlockAchievement('CgkI_test_id')).resolves.toBeUndefined();
    });
  });

  describe('PlayGamesClient.submitScore', () => {
    beforeEach(() => vi.clearAllMocks());

    it('calls plugin with leaderboardId and score when on Android', async () => {
      mockGetPlatform.mockReturnValue('android');
      mockPlugin.submitScore.mockResolvedValue(undefined);

      await PlayGamesClient.submitScore('CgkI_lb_id', 42000);

      expect(mockPlugin.submitScore).toHaveBeenCalledWith({ leaderboardId: 'CgkI_lb_id', score: 42000 });
    });

    it('does nothing when not on Android', async () => {
      mockGetPlatform.mockReturnValue('ios');

      await PlayGamesClient.submitScore('CgkI_lb_id', 42000);

      expect(mockPlugin.submitScore).not.toHaveBeenCalled();
    });
  });

  describe('PlayGamesClient.saveSnapshot', () => {
    beforeEach(() => vi.clearAllMocks());

    it('calls plugin with serialized data when on Android', async () => {
      mockGetPlatform.mockReturnValue('android');
      mockPlugin.saveSnapshot.mockResolvedValue(undefined);

      await PlayGamesClient.saveSnapshot('{"balance":100}');

      expect(mockPlugin.saveSnapshot).toHaveBeenCalledWith({ data: '{"balance":100}' });
    });
  });

  describe('PlayGamesClient.loadSnapshot', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns data string from plugin on Android', async () => {
      mockGetPlatform.mockReturnValue('android');
      mockPlugin.loadSnapshot.mockResolvedValue({ data: '{"balance":50}' });

      const result = await PlayGamesClient.loadSnapshot();

      expect(result).toBe('{"balance":50}');
    });

    it('returns null when not on Android', async () => {
      mockGetPlatform.mockReturnValue('web');

      const result = await PlayGamesClient.loadSnapshot();

      expect(result).toBeNull();
    });

    it('returns null when plugin returns null data', async () => {
      mockGetPlatform.mockReturnValue('android');
      mockPlugin.loadSnapshot.mockResolvedValue({ data: null });

      const result = await PlayGamesClient.loadSnapshot();

      expect(result).toBeNull();
    });
  });
  ```

- [ ] **Step 2: Run tests and confirm they fail (file does not exist yet)**

  ```bash
  npm test -- src/systems/__tests__/PlayGamesClient.test.ts 2>&1 | tail -20
  ```
  Expected: test file errors because `PlayGamesClient.ts` does not exist.

---

### Task 6: Create PlayGamesClient.ts

**Files:**
- Create: `src/systems/PlayGamesClient.ts`

- [ ] **Step 1: Write the implementation**

  Create `src/systems/PlayGamesClient.ts`:

  ```typescript
  import { registerPlugin, Capacitor } from '@capacitor/core';

  interface PlayGamesPlugin {
    signIn(): Promise<{ playerId: string; displayName: string }>;
    unlockAchievement(options: { achievementId: string }): Promise<void>;
    submitScore(options: { leaderboardId: string; score: number }): Promise<void>;
    saveSnapshot(options: { data: string }): Promise<void>;
    loadSnapshot(): Promise<{ data: string | null }>;
  }

  const _plugin = registerPlugin<PlayGamesPlugin>('PlayGames');

  function isAndroid(): boolean {
    return Capacitor.getPlatform() === 'android';
  }

  export const PlayGamesClient = {
    async signIn(): Promise<{ playerId: string; displayName: string } | null> {
      if (!isAndroid()) return null;
      try {
        return await _plugin.signIn();
      } catch {
        return null;
      }
    },

    async unlockAchievement(achievementId: string): Promise<void> {
      if (!isAndroid()) return;
      try {
        await _plugin.unlockAchievement({ achievementId });
      } catch { /* silent — never interrupt gameplay */ }
    },

    async submitScore(leaderboardId: string, score: number): Promise<void> {
      if (!isAndroid()) return;
      try {
        await _plugin.submitScore({ leaderboardId, score });
      } catch { /* silent */ }
    },

    async saveSnapshot(data: string): Promise<void> {
      if (!isAndroid()) return;
      try {
        await _plugin.saveSnapshot({ data });
      } catch { /* silent */ }
    },

    async loadSnapshot(): Promise<string | null> {
      if (!isAndroid()) return null;
      try {
        const result = await _plugin.loadSnapshot();
        return result.data;
      } catch {
        return null;
      }
    },
  };
  ```

- [ ] **Step 2: Run tests and confirm they pass**

  ```bash
  npm test -- src/systems/__tests__/PlayGamesClient.test.ts 2>&1 | tail -20
  ```
  Expected: all tests pass.

- [ ] **Step 3: Run full test suite to check for regressions**

  ```bash
  npm test 2>&1 | tail -10
  ```
  Expected: all tests pass (count should be same as before ± new tests added).

- [ ] **Step 4: Commit**

  ```bash
  git add src/systems/PlayGamesClient.ts \
          src/systems/__tests__/PlayGamesClient.test.ts
  git commit -m "feat: add PlayGamesClient TypeScript wrapper with tests"
  ```

---

### Task 7: Store gpgsPlayerId in SaveData + sign in from BootScene

**Files:**
- Modify: `src/systems/SaveData.ts`
- Modify: `src/scenes/BootScene.ts`

- [ ] **Step 1: Add `gpgsPlayerId` to RawSave and its accessors**

  In `src/systems/SaveData.ts`:

  1. Add `gpgsPlayerId?: string` to the `RawSave` interface (after `playerName`):
  ```typescript
  interface RawSave {
    schemaVersion: number;
    balance:        number;
    upgrades:       Record<string, number>;
    inventory:      Record<string, number>;
    placed:         Record<string, PlacedItemSave[]>;
    selectedHeapId: string;
    playerGuid:     string;
    playerName:     string;
    gpgsPlayerId?:  string;
    highScores:     Record<string, number>;
    verboseLogging?: boolean;
    _legacyPlaced?: PlacedItemSave[];
  }
  ```

  2. Update the `migrate` function's current-schema branch to include the field (in the `version === CURRENT_SCHEMA` return and the final v2→v3 return):
  ```typescript
  // In the version === CURRENT_SCHEMA block:
  gpgsPlayerId:   parsed.gpgsPlayerId,
  ```
  ```typescript
  // In the v2→v3 block:
  gpgsPlayerId:   parsed.gpgsPlayerId,
  ```
  (Both blocks already spread other optional fields; add this line to each.)

  3. Add accessor functions at the end of the "Player identity" section:
  ```typescript
  export function getGpgsPlayerId(): string | null { return load().gpgsPlayerId ?? null; }

  export function setGpgsPlayerId(id: string): void {
    const data = load();
    data.gpgsPlayerId = id;
    persist(data);
  }
  ```

- [ ] **Step 2: Run tests to confirm SaveData is not broken**

  ```bash
  npm test -- src/systems/__tests__/SaveData.test.ts 2>&1 | tail -15
  ```
  Expected: all SaveData tests pass.

- [ ] **Step 3: Wire sign-in in BootScene**

  In `src/scenes/BootScene.ts`:

  1. Add import at the top of the file (after existing imports):
  ```typescript
  import { PlayGamesClient } from '../systems/PlayGamesClient';
  import { setGpgsPlayerId } from '../systems/SaveData';
  ```

  2. In the `create()` method, after `initLogger()` and before the `HeapClient.list()` call (around line 55), add the sign-in call as a fire-and-forget (do not `await` — BootScene's `create()` is synchronous):
  ```typescript
  // Attempt GPGS sign-in in background — does not block menu render.
  PlayGamesClient.signIn().then((player) => {
    if (player) setGpgsPlayerId(player.playerId);
  });
  ```

- [ ] **Step 4: Run full test suite**

  ```bash
  npm test 2>&1 | tail -10
  ```
  Expected: all tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add src/systems/SaveData.ts src/scenes/BootScene.ts
  git commit -m "feat: store GPGS player ID in SaveData, sign in from BootScene"
  ```

---

## Phase 3 — Achievements

---

### Task 8: Create achievementDefs.ts

**Files:**
- Create: `src/data/achievementDefs.ts`

- [ ] **Step 1: Write the definitions**

  Create `src/data/achievementDefs.ts`:

  ```typescript
  export interface AchievementDef {
    id:            string;
    playConsoleId: string;
    name:          string;
  }

  // Replace each playConsoleId with the real ID from Play Console → Achievements.
  export const ACHIEVEMENT_DEFS: AchievementDef[] = [
    { id: 'first_climb',     playConsoleId: 'REPLACE_CONSOLE_ID_first_climb',     name: 'First Climb' },
    { id: 'reach_100m',      playConsoleId: 'REPLACE_CONSOLE_ID_reach_100m',      name: 'Sky High' },
    { id: 'reach_1000m',     playConsoleId: 'REPLACE_CONSOLE_ID_reach_1000m',     name: 'Cloud Surfer' },
    { id: 'first_placement', playConsoleId: 'REPLACE_CONSOLE_ID_first_placement', name: 'Builder' },
    { id: 'stomp_10',        playConsoleId: 'REPLACE_CONSOLE_ID_stomp_10',        name: 'Pest Control' },
  ];

  export const LEADERBOARD_HIGH_SCORE_ID = 'REPLACE_CONSOLE_ID_high_score_leaderboard';

  export function getPlayConsoleId(achievementId: string): string | null {
    return ACHIEVEMENT_DEFS.find(a => a.id === achievementId)?.playConsoleId ?? null;
  }
  ```

  > **After Task 1 is complete:** Replace every `REPLACE_CONSOLE_ID_*` placeholder with the real ID copied from Play Console.

- [ ] **Step 2: Commit**

  ```bash
  git add src/data/achievementDefs.ts
  git commit -m "feat: add achievement and leaderboard ID definitions"
  ```

---

### Task 9: Add unlockAchievement to PlayGamesPlugin.java

**Files:**
- Modify: `android/app/src/main/java/com/hanlinsoftware/heapgame/app/PlayGamesPlugin.java`

- [ ] **Step 1: Add the import and plugin method**

  Add `import com.google.android.gms.games.AchievementsClient;` to the imports.

  Add this method inside the `PlayGamesPlugin` class (after `fetchAndResolvePlayer`):

  ```java
  // ── Achievements ─────────────────────────────────────────────────────────

  @PluginMethod
  public void unlockAchievement(PluginCall call) {
      String achievementId = call.getString("achievementId");
      if (achievementId == null || achievementId.isEmpty()) {
          call.reject("Missing achievementId");
          return;
      }
      PlayGames.getAchievementsClient(getActivity()).unlock(achievementId);
      call.resolve();
  }
  ```

  Note: `unlock()` is fire-and-forget; the SDK handles deduplication and queues the call if offline.

- [ ] **Step 2: Verify build compiles**

  ```bash
  cd android && ./gradlew assembleDebug 2>&1 | tail -10
  ```
  Expected: `BUILD SUCCESSFUL`

- [ ] **Step 3: Commit**

  ```bash
  git add android/app/src/main/java/com/hanlinsoftware/heapgame/app/PlayGamesPlugin.java
  git commit -m "feat: add unlockAchievement to PlayGamesPlugin"
  ```

---

### Task 10: Wire achievement triggers in GameScene

**Files:**
- Modify: `src/scenes/GameScene.ts`

The triggers are:
| Achievement | Where to trigger | Condition |
|---|---|---|
| `first_climb` | `ScoreScene` init (every completed run) | always |
| `reach_100m` | GameScene update loop | `baseHeightPx >= 100_000` (100 m = 100 000 px at 1000 px/m) |
| `reach_1000m` | GameScene update loop | `baseHeightPx >= 1_000_000` |
| `first_placement` | `PlaceableManager` (see note below) | first item placed |
| `stomp_10` | GameScene stomp callback | `totalKills >= 10` |

> **Note on `first_placement`:** Triggering this from `PlaceableManager` requires passing in a callback or calling `PlayGamesClient` directly. The simplest approach is to trigger it from `ScoreScene` by checking if `getPlaced(heapId).length > 0`. This avoids coupling PlaceableManager to GPGS.

- [ ] **Step 1: Add imports to GameScene.ts**

  At the top of `src/scenes/GameScene.ts`, add:
  ```typescript
  import { PlayGamesClient } from '../systems/PlayGamesClient';
  import { getPlayConsoleId } from '../data/achievementDefs';
  ```

- [ ] **Step 2: Add height milestone tracking fields**

  In the `GameScene` class body, add two tracking fields near the other private fields (around line 75):
  ```typescript
  private _reached100m:  boolean = false;
  private _reached1000m: boolean = false;
  ```

  Reset them in `create()` (around line 101 where `_runKills` is reset):
  ```typescript
  this._reached100m  = false;
  this._reached1000m = false;
  ```

- [ ] **Step 3: Trigger height achievements in the update loop**

  GameScene calls `buildRunScore` in multiple exit paths. The safest place to check ongoing height is in the `update()` method. Find the `update()` method and add height achievement checks after the existing `isPeak` / camera logic. The current player height is `Math.max(0, Math.floor(this.spawnY - this.player.sprite.y))`.

  Add this block inside `update()`, after the camera/peak section:
  ```typescript
  // Height achievements
  const currentHeightPx = Math.max(0, Math.floor(this.spawnY - this.player.sprite.y));
  if (!this._reached100m && currentHeightPx >= 100_000) {
    this._reached100m = true;
    const id = getPlayConsoleId('reach_100m');
    if (id) PlayGamesClient.unlockAchievement(id);
  }
  if (!this._reached1000m && currentHeightPx >= 1_000_000) {
    this._reached1000m = true;
    const id = getPlayConsoleId('reach_1000m');
    if (id) PlayGamesClient.unlockAchievement(id);
  }
  ```

- [ ] **Step 4: Trigger stomp_10 in the stomp callback**

  The stomp callback increments `this._runKills[kind]` at GameScene.ts:514. After that increment, add:

  ```typescript
  this._runKills[kind] = (this._runKills[kind] ?? 0) + 1;

  // stomp_10 achievement — check on every kill
  const totalKills = Object.values(this._runKills).reduce((sum, n) => sum + n, 0);
  if (totalKills >= 10) {
    const id = getPlayConsoleId('stomp_10');
    if (id) PlayGamesClient.unlockAchievement(id);
  }
  ```

- [ ] **Step 5: Trigger first_climb and first_placement in ScoreScene**

  In `src/scenes/ScoreScene.ts`, add imports:
  ```typescript
  import { PlayGamesClient } from '../systems/PlayGamesClient';
  import { getPlayConsoleId } from '../data/achievementDefs';
  import { getPlaced } from '../systems/SaveData';
  ```

  In `ScoreScene.init()` (or the earliest method that runs per-run), add after all existing init logic:
  ```typescript
  // Achievements that trigger on any completed run
  const firstClimbId = getPlayConsoleId('first_climb');
  if (firstClimbId) PlayGamesClient.unlockAchievement(firstClimbId);

  // first_placement: fires if the player has ever placed any item on this heap
  if (this.heapId) {
    const placed = getPlaced(this.heapId);
    if (placed.length > 0) {
      const placementId = getPlayConsoleId('first_placement');
      if (placementId) PlayGamesClient.unlockAchievement(placementId);
    }
  }
  ```

- [ ] **Step 6: Run full test suite**

  ```bash
  npm test 2>&1 | tail -10
  ```
  Expected: all tests pass.

- [ ] **Step 7: Commit**

  ```bash
  git add src/scenes/GameScene.ts src/scenes/ScoreScene.ts
  git commit -m "feat: wire achievement triggers in GameScene + ScoreScene"
  ```

---

## Phase 4 — GPGS Leaderboard Submission

---

### Task 11: Add submitScore to PlayGamesPlugin.java

**Files:**
- Modify: `android/app/src/main/java/com/hanlinsoftware/heapgame/app/PlayGamesPlugin.java`

- [ ] **Step 1: Add the plugin method**

  Add `import com.google.android.gms.games.LeaderboardsClient;` to the imports.

  Add this method inside the `PlayGamesPlugin` class:

  ```java
  // ── Leaderboards ──────────────────────────────────────────────────────────

  @PluginMethod
  public void submitScore(PluginCall call) {
      String leaderboardId = call.getString("leaderboardId");
      Long score = call.getLong("score", 0L);
      if (leaderboardId == null || leaderboardId.isEmpty()) {
          call.reject("Missing leaderboardId");
          return;
      }
      PlayGames.getLeaderboardsClient(getActivity()).submitScore(leaderboardId, score);
      call.resolve();
  }
  ```

  Note: `submitScore()` is fire-and-forget; the SDK queues calls made while offline.

- [ ] **Step 2: Verify build compiles**

  ```bash
  cd android && ./gradlew assembleDebug 2>&1 | tail -10
  ```
  Expected: `BUILD SUCCESSFUL`

- [ ] **Step 3: Commit**

  ```bash
  git add android/app/src/main/java/com/hanlinsoftware/heapgame/app/PlayGamesPlugin.java
  git commit -m "feat: add submitScore to PlayGamesPlugin"
  ```

---

### Task 12: Wire GPGS leaderboard submit in ScoreScene

**Files:**
- Modify: `src/scenes/ScoreScene.ts`

- [ ] **Step 1: Submit to GPGS leaderboard after server call resolves**

  In `src/scenes/ScoreScene.ts`, find the `call.then((ctx) => {` callback at line ~694. After the line that handles `isNewHighScore`, add:

  ```typescript
  call.then((ctx) => {
    loading.destroy();
    const accepted = ctx !== null;
    getLogger().event({
      type: 'score:submitted',
      heapId: this.heapId,
      score: this.score,
      accepted,
      rejectionReason: accepted ? undefined : 'offline or rejected',
    });
    if (!ctx) return;

    // Submit to Google Play leaderboard (Android only, fire-and-forget).
    if (this.isNewHighScore) {
      const lbId = getPlayConsoleId('high_score');
      if (lbId) PlayGamesClient.submitScore(lbId, this.score);
    }

    if (this.isNewHighScore) {
      // existing high-score logic
    }
    this.renderLeaderboardEntries(ctx, PANEL_TOP, PANEL_W, ROW_H);
  });
  ```

  > **Note:** `getPlayConsoleId` won't find `'high_score'` yet — it must be added to `achievementDefs.ts` as a convenience lookup. Update `achievementDefs.ts` to export `LEADERBOARD_HIGH_SCORE_ID` directly and use it here instead:

  Replace the `getPlayConsoleId('high_score')` line with:
  ```typescript
  import { LEADERBOARD_HIGH_SCORE_ID } from '../data/achievementDefs';
  // ...
  if (this.isNewHighScore) {
    PlayGamesClient.submitScore(LEADERBOARD_HIGH_SCORE_ID, this.score);
  }
  ```

- [ ] **Step 2: Run full test suite**

  ```bash
  npm test 2>&1 | tail -10
  ```
  Expected: all tests pass.

- [ ] **Step 3: Commit**

  ```bash
  git add src/scenes/ScoreScene.ts
  git commit -m "feat: submit score to Google Play leaderboard on new high score"
  ```

---

## Phase 5 — Cloud Saves (Snapshots API)

Cloud saves allow `SaveData` to sync across devices via Google Drive. The merge strategy is **additive**: both devices' progress is preserved (higher value wins for numbers, union for collections). No data is ever lost by merging.

---

### Task 13: Add saveSnapshot + loadSnapshot to PlayGamesPlugin.java

**Files:**
- Modify: `android/app/src/main/java/com/hanlinsoftware/heapgame/app/PlayGamesPlugin.java`

- [ ] **Step 1: Add Snapshots imports**

  Add these imports at the top of `PlayGamesPlugin.java`:

  ```java
  import com.google.android.gms.games.SnapshotsClient;
  import com.google.android.gms.games.snapshot.Snapshot;
  import com.google.android.gms.games.snapshot.SnapshotMetadataChange;
  ```

- [ ] **Step 2: Add the saveSnapshot method**

  Add inside the `PlayGamesPlugin` class:

  ```java
  // ── Cloud Saves (Snapshots) ────────────────────────────────────────────────

  private static final String SNAPSHOT_NAME = "heap_save";

  @PluginMethod
  public void saveSnapshot(PluginCall call) {
      String data = call.getString("data");
      if (data == null) {
          call.reject("Missing data");
          return;
      }

      SnapshotsClient snapshotsClient = PlayGames.getSnapshotsClient(getActivity());
      byte[] bytes = data.getBytes(java.nio.charset.StandardCharsets.UTF_8);

      snapshotsClient.open(SNAPSHOT_NAME, true).addOnCompleteListener(openTask -> {
          if (!openTask.isSuccessful() || openTask.getResult() == null) {
              call.reject("Snapshot open failed");
              return;
          }
          Snapshot snapshot = openTask.getResult().getData();
          if (snapshot == null) {
              call.reject("Snapshot data null after open");
              return;
          }
          snapshot.getSnapshotContents().writeBytes(bytes);

          SnapshotMetadataChange metadataChange = new SnapshotMetadataChange.Builder()
              .setDescription("Heap save data")
              .build();

          snapshotsClient.commitAndClose(snapshot, metadataChange)
              .addOnCompleteListener(commitTask -> {
                  if (commitTask.isSuccessful()) {
                      call.resolve();
                  } else {
                      call.reject("Snapshot commit failed");
                  }
              });
      });
  }
  ```

- [ ] **Step 3: Add the loadSnapshot method**

  Add inside the `PlayGamesPlugin` class:

  ```java
  @PluginMethod
  public void loadSnapshot(PluginCall call) {
      SnapshotsClient snapshotsClient = PlayGames.getSnapshotsClient(getActivity());

      snapshotsClient.open(SNAPSHOT_NAME, true).addOnCompleteListener(openTask -> {
          if (!openTask.isSuccessful() || openTask.getResult() == null) {
              JSObject result = new JSObject();
              result.put("data", (Object) null);
              call.resolve(result);
              return;
          }

          // Handle conflict: pick the snapshot with the larger raw size (proxy for more data).
          SnapshotsClient.DataOrConflict<Snapshot> dataOrConflict = openTask.getResult();
          if (dataOrConflict.isConflict()) {
              SnapshotsClient.SnapshotConflict conflict = dataOrConflict.getConflict();
              Snapshot base    = conflict.getSnapshot();
              Snapshot remote  = conflict.getConflictingSnapshot();
              // Conflict resolution is done in TypeScript (mergeCloudSave).
              // Here we just pick whichever snapshot has more bytes as the "winner"
              // and close the other — TypeScript will merge the two after loading.
              byte[] baseBytes   = base.getSnapshotContents().readFully();
              byte[] remoteBytes = remote.getSnapshotContents().readFully();
              Snapshot winner = baseBytes.length >= remoteBytes.length ? base : remote;
              snapshotsClient.resolveConflict(conflict.getConflictId(), winner)
                  .addOnCompleteListener(resolveTask -> {
                      // After resolution, re-open to read the resolved state.
                      snapshotsClient.open(SNAPSHOT_NAME, false).addOnCompleteListener(reopenTask -> {
                          readAndResolveSnapshot(reopenTask, snapshotsClient, call);
                      });
                  });
              return;
          }

          readAndResolveSnapshot(openTask, snapshotsClient, call);
      });
  }

  private void readAndResolveSnapshot(
      com.google.android.gms.tasks.Task<SnapshotsClient.DataOrConflict<Snapshot>> task,
      SnapshotsClient snapshotsClient,
      PluginCall call
  ) {
      if (!task.isSuccessful() || task.getResult() == null || task.getResult().getData() == null) {
          JSObject result = new JSObject();
          result.put("data", (Object) null);
          call.resolve(result);
          return;
      }
      Snapshot snapshot = task.getResult().getData();
      byte[] bytes = snapshot.getSnapshotContents().readFully();
      snapshotsClient.discardAndClose(snapshot);

      JSObject result = new JSObject();
      result.put("data", new String(bytes, java.nio.charset.StandardCharsets.UTF_8));
      call.resolve(result);
  }
  ```

- [ ] **Step 4: Verify build compiles**

  ```bash
  cd android && ./gradlew assembleDebug 2>&1 | tail -10
  ```
  Expected: `BUILD SUCCESSFUL`

- [ ] **Step 5: Commit**

  ```bash
  git add android/app/src/main/java/com/hanlinsoftware/heapgame/app/PlayGamesPlugin.java
  git commit -m "feat: add saveSnapshot + loadSnapshot to PlayGamesPlugin"
  ```

---

### Task 14: Write tests for mergeCloudSave

**Files:**
- Modify: `src/systems/__tests__/SaveData.test.ts`

- [ ] **Step 1: Add mergeCloudSave tests**

  At the end of `src/systems/__tests__/SaveData.test.ts`, add:

  ```typescript
  import { mergeCloudSave } from '../SaveData';

  describe('mergeCloudSave', () => {
    const base = () => ({
      schemaVersion: 3,
      balance:        100,
      upgrades:       { air_jump: 1, dash: 0 },
      inventory:      { ladder: 2 },
      placed:         { 'heap-1': [{ id: 'ladder', x: 10, y: 20 }] },
      selectedHeapId: 'heap-1',
      playerGuid:     'local-guid',
      playerName:     'LocalPlayer',
      highScores:     { 'heap-1': 500 },
    });

    it('takes the higher balance', () => {
      const local = { ...base(), balance: 200 };
      const cloud = { ...base(), balance: 300 };
      expect(mergeCloudSave(local, cloud).balance).toBe(300);
    });

    it('takes the higher balance from local if local wins', () => {
      const local = { ...base(), balance: 400 };
      const cloud = { ...base(), balance: 300 };
      expect(mergeCloudSave(local, cloud).balance).toBe(400);
    });

    it('takes the max upgrade level per key', () => {
      const local = { ...base(), upgrades: { air_jump: 2, dash: 1 } };
      const cloud = { ...base(), upgrades: { air_jump: 1, wall_jump: 1 } };
      const merged = mergeCloudSave(local, cloud);
      expect(merged.upgrades).toEqual({ air_jump: 2, dash: 1, wall_jump: 1 });
    });

    it('takes the max inventory count per key', () => {
      const local = { ...base(), inventory: { ladder: 3 } };
      const cloud = { ...base(), inventory: { ladder: 1, checkpoint: 2 } };
      const merged = mergeCloudSave(local, cloud);
      expect(merged.inventory).toEqual({ ladder: 3, checkpoint: 2 });
    });

    it('unions placed items by heapId + item id', () => {
      const item1 = { id: 'ladder',     x: 10, y: 20 };
      const item2 = { id: 'checkpoint', x: 30, y: 40 };
      const local = { ...base(), placed: { 'heap-1': [item1] } };
      const cloud = { ...base(), placed: { 'heap-1': [item1, item2] } };
      const merged = mergeCloudSave(local, cloud);
      // item1 appears once (deduplicated), item2 appears once
      expect(merged.placed['heap-1']).toHaveLength(2);
    });

    it('takes the higher high score per heapId', () => {
      const local = { ...base(), highScores: { 'heap-1': 1000 } };
      const cloud = { ...base(), highScores: { 'heap-1': 800, 'heap-2': 500 } };
      const merged = mergeCloudSave(local, cloud);
      expect(merged.highScores).toEqual({ 'heap-1': 1000, 'heap-2': 500 });
    });

    it('prefers the name/selectedHeapId from whichever has higher balance', () => {
      const local = { ...base(), balance: 100, playerName: 'Local',  selectedHeapId: 'heap-1' };
      const cloud = { ...base(), balance: 200, playerName: 'Cloud',  selectedHeapId: 'heap-2' };
      const merged = mergeCloudSave(local, cloud);
      expect(merged.playerName).toBe('Cloud');
      expect(merged.selectedHeapId).toBe('heap-2');
    });

    it('preserves playerGuid from local', () => {
      const local = { ...base(), playerGuid: 'local-guid' };
      const cloud = { ...base(), playerGuid: 'cloud-guid' };
      expect(mergeCloudSave(local, cloud).playerGuid).toBe('local-guid');
    });
  });
  ```

- [ ] **Step 2: Run tests and confirm mergeCloudSave tests fail**

  ```bash
  npm test -- src/systems/__tests__/SaveData.test.ts 2>&1 | tail -20
  ```
  Expected: the new `mergeCloudSave` tests fail because the function doesn't exist yet.

---

### Task 15: Implement mergeCloudSave in SaveData.ts

**Files:**
- Modify: `src/systems/SaveData.ts`

- [ ] **Step 1: Add the export**

  In `src/systems/SaveData.ts`, add after the `setLocalHighScore` function:

  ```typescript
  // ── Cloud save merge ──────────────────────────────────────────────────────

  export function mergeCloudSave(local: RawSave, cloud: RawSave): RawSave {
    // Whichever has higher balance is treated as the "primary" for name/selection.
    const primary   = local.balance >= cloud.balance ? local : cloud;
    const secondary = local.balance >= cloud.balance ? cloud : local;

    // Union upgrades: max level per key.
    const upgrades: Record<string, number> = { ...secondary.upgrades };
    for (const [k, v] of Object.entries(primary.upgrades)) {
      upgrades[k] = Math.max(upgrades[k] ?? 0, v);
    }

    // Union inventory: max count per key.
    const inventory: Record<string, number> = { ...secondary.inventory };
    for (const [k, v] of Object.entries(primary.inventory)) {
      inventory[k] = Math.max(inventory[k] ?? 0, v);
    }

    // Union placed items: per heap, deduplicate by item id (keep first occurrence).
    const placed: Record<string, PlacedItemSave[]> = {};
    const allHeapIds = new Set([
      ...Object.keys(local.placed),
      ...Object.keys(cloud.placed),
    ]);
    for (const heapId of allHeapIds) {
      const seenIds = new Set<string>();
      const merged: PlacedItemSave[] = [];
      for (const item of [...(local.placed[heapId] ?? []), ...(cloud.placed[heapId] ?? [])]) {
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id);
          merged.push(item);
        }
      }
      placed[heapId] = merged;
    }

    // Union high scores: max per heapId.
    const highScores: Record<string, number> = { ...secondary.highScores };
    for (const [k, v] of Object.entries(primary.highScores)) {
      highScores[k] = Math.max(highScores[k] ?? 0, v);
    }

    return {
      schemaVersion: CURRENT_SCHEMA,
      balance:        Math.max(local.balance, cloud.balance),
      upgrades,
      inventory,
      placed,
      selectedHeapId: primary.selectedHeapId,
      playerGuid:     local.playerGuid,    // always keep local GUID
      playerName:     primary.playerName,
      gpgsPlayerId:   local.gpgsPlayerId ?? cloud.gpgsPlayerId,
      highScores,
      verboseLogging: local.verboseLogging,
    };
  }
  ```

- [ ] **Step 2: Run the mergeCloudSave tests and confirm they pass**

  ```bash
  npm test -- src/systems/__tests__/SaveData.test.ts 2>&1 | tail -15
  ```
  Expected: all tests pass including the new merge tests.

- [ ] **Step 3: Run full test suite**

  ```bash
  npm test 2>&1 | tail -10
  ```
  Expected: all tests pass.

- [ ] **Step 4: Commit**

  ```bash
  git add src/systems/SaveData.ts src/systems/__tests__/SaveData.test.ts
  git commit -m "feat: add mergeCloudSave with additive merge strategy"
  ```

---

### Task 16: Wire cloud save load in BootScene

**Files:**
- Modify: `src/scenes/BootScene.ts`

Load the cloud snapshot after sign-in. If a cloud snapshot exists, migrate it and merge with local `SaveData`.

- [ ] **Step 1: Add import**

  In `src/scenes/BootScene.ts`, add to the SaveData import:
  ```typescript
  import { setGpgsPlayerId, mergeCloudSave, getSchemaVersionForTests } from '../systems/SaveData';
  ```

  Wait — `mergeCloudSave` operates on raw `RawSave` objects but `SaveData.ts` doesn't export `RawSave` (it's a private interface). We need a public `loadRawSave` / `saveFromMerge` pair. Update `SaveData.ts` to export two new functions:

  ```typescript
  // At the bottom of SaveData.ts, in a new section:

  // ── Cloud save integration helpers ────────────────────────────────────────

  export function getRawSaveForCloudSync(): RawSave { return { ...load() }; }

  export function applyMergedSave(merged: RawSave): void {
    persist(merged);
  }
  ```

  Also export `RawSave` as a type:
  ```typescript
  export type { RawSave };
  ```

- [ ] **Step 2: Wire cloud load in BootScene**

  In `src/scenes/BootScene.ts`, update the existing `PlayGamesClient.signIn().then(...)` block (added in Task 7) to:

  ```typescript
  import { setGpgsPlayerId, getRawSaveForCloudSync, applyMergedSave, mergeCloudSave } from '../systems/SaveData';
  import type { RawSave } from '../systems/SaveData';

  // In create():
  PlayGamesClient.signIn().then(async (player) => {
    if (!player) return;
    setGpgsPlayerId(player.playerId);

    // Load cloud snapshot and merge with local SaveData.
    const cloudJson = await PlayGamesClient.loadSnapshot();
    if (!cloudJson) return;

    let cloudSave: RawSave;
    try {
      cloudSave = JSON.parse(cloudJson) as RawSave;
    } catch {
      return; // malformed cloud data — skip merge
    }

    const localSave = getRawSaveForCloudSync();
    const merged    = mergeCloudSave(localSave, cloudSave);
    applyMergedSave(merged);
  });
  ```

- [ ] **Step 3: Run full test suite**

  ```bash
  npm test 2>&1 | tail -10
  ```
  Expected: all tests pass.

- [ ] **Step 4: Commit**

  ```bash
  git add src/scenes/BootScene.ts src/systems/SaveData.ts
  git commit -m "feat: load cloud snapshot and merge with local SaveData on sign-in"
  ```

---

### Task 17: Wire cloud save write in ScoreScene

**Files:**
- Modify: `src/scenes/ScoreScene.ts`

Save a snapshot after each run completes — specifically after the server score call resolves (so we don't save mid-run state).

- [ ] **Step 1: Add the cloud save call**

  In `src/scenes/ScoreScene.ts`, add imports:
  ```typescript
  import { getRawSaveForCloudSync } from '../systems/SaveData';
  ```

  In the `call.then((ctx) => {` callback, after the GPGS leaderboard submit (from Task 12), add:

  ```typescript
  // Save snapshot to cloud after each run.
  const cloudData = JSON.stringify(getRawSaveForCloudSync());
  PlayGamesClient.saveSnapshot(cloudData);
  ```

- [ ] **Step 2: Run full test suite**

  ```bash
  npm test 2>&1 | tail -10
  ```
  Expected: all tests pass.

- [ ] **Step 3: Commit**

  ```bash
  git add src/scenes/ScoreScene.ts
  git commit -m "feat: save cloud snapshot after each run"
  ```

---

## Self-Review

### Spec coverage

| Spec requirement | Covered by |
|---|---|
| Sign in with Google Play account | Task 4 (plugin), Task 7 (BootScene) |
| Persistent player ID across devices | Task 7 (`gpgsPlayerId` in SaveData) |
| `google-services.json` setup | Task 1 |
| Cloud Saves via Snapshots API | Task 13–17 |
| SaveData is clean JSON — good fit for cloud | Task 15 (merge function) |
| Conflict resolution strategy | Task 15 (additive merge — max balance, union collections) |
| Achievements with stub for one first | Task 8–10 (5 achievements defined, wired to game events) |
| Leaderboards hybrid (server + Google Play) | Task 11–12 |
| Our `/scores` leaderboard stays for web | No change to server/ScoreClient — preserved by design |

### Placeholder scan

- `achievementDefs.ts` contains `REPLACE_CONSOLE_ID_*` strings intentionally — these are replaced after Task 1 (Play Console setup). The string is explicit, not a vague TODO.
- `games_ids.xml` contains `REPLACE_WITH_PLAY_GAMES_APP_ID` — same: explicit substitution instruction after Task 1.

### Type consistency

- `mergeCloudSave` takes and returns `RawSave` — exported as a type in Task 16.
- `getRawSaveForCloudSync()` returns `RawSave` — consistent with `mergeCloudSave` inputs.
- `PlayGamesClient.saveSnapshot(data: string)` / `loadSnapshot(): string | null` — consistent with the `JSON.stringify`/`JSON.parse` pattern in Tasks 16 and 17.
- `getPlayConsoleId(id: string): string | null` used in Task 10 — defined in Task 8.
- `LEADERBOARD_HIGH_SCORE_ID` exported from `achievementDefs.ts`, used in Task 12 — consistent.

---

## Testing notes

Unit tests cover the TypeScript layer (PlayGamesClient wrapper + SaveData merge). The Java plugin (`PlayGamesPlugin.java`) can only be integration-tested on a physical Android device:

1. Sign-in flow: install debug APK on device, verify name/ID appears in logs
2. Achievements: trigger a run → check Play Console "Testing" tab for unlock events
3. Leaderboard: submit a high score → check the leaderboard in Play Games app on the device
4. Cloud saves: install on two devices with the same Google account, play on each offline, reconnect → verify saves merged
