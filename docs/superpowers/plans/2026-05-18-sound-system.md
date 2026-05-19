# Sound System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a categorized audio system with per-category volume controls, persistent settings, distance-based wall proximity rumble, and a tabbed settings panel in MenuScene.

**Architecture:** `AudioManager` singleton wraps Phaser's built-in `SoundManager` and applies master × category volume multipliers. Sound definitions live in `src/data/soundDefs.ts`; settings persist in `SaveData` (schema v4). The tabbed settings panel restructures the existing `createSettingsButton()` method into Sounds and Dev tab containers.

**Tech Stack:** Phaser 3 SoundManager, Vite `?url` imports for audio assets, Vitest for unit tests.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/audio/stub.mp3` | Placeholder audio file for all sounds during development |
| Create | `src/data/soundDefs.ts` | Sound key registry: category, baseVolume, loop, url |
| Create | `src/systems/AudioManager.ts` | Singleton: volume math, play/stop, wall proximity, category update |
| Create | `src/systems/__tests__/AudioManager.test.ts` | Unit tests for pure math functions |
| Modify | `src/systems/SaveData.ts` | Schema v3→v4: add `SoundSettings`, `getSoundSettings`, `setSoundVolume` |
| Modify | `src/systems/__tests__/SaveData.test.ts` | Migration test: v3 save gets default soundSettings |
| Modify | `src/scenes/loadGameAssets.ts` | Load all audio keys from SOUND_DEFS |
| Modify | `src/scenes/BootScene.ts` | `AudioManager.init(this.sound)` after textures |
| Modify | `src/systems/TrashWallManager.ts` | Add `get currentWallY(): number` public getter |
| Modify | `src/constants.ts` | Add `MAX_WALL_AUDIBLE_DISTANCE = 1200` |
| Modify | `src/scenes/GameScene.ts` | Proximity call in `update()`, `player-die` in onKill, `enemy-kill` in stomp, `stopAll()` in shutdown, `music-game` in `create()` |
| Modify | `src/scenes/InfiniteGameScene.ts` | Proximity call in `update()`, `stopAll()` in shutdown, `music-game` in `create()` |
| Modify | `src/scenes/MenuScene.ts` | `music-menu` in `create()`, tabbed settings panel, volume sliders |
| Modify | `src/scenes/ScoreScene.ts` | `music-score` in `create()` |
| Modify | `src/entities/Player.ts` | `player-jump` on jump, `player-land` on landing transition |
| Modify | `src/systems/EnemyManager.ts` | `enemy-vulture-ambient` start on vulture spawn, stop when last vulture culled |

---

## Task 1: Stub audio file + sound definitions

**Files:**
- Create: `src/audio/stub.mp3`
- Create: `src/data/soundDefs.ts`

- [ ] **Step 1: Generate stub audio file**

Run this in the repo root (requires ffmpeg). If ffmpeg is unavailable, copy any short MP3 and rename it:
```bash
ffmpeg -f lavfi -i "sine=frequency=440:duration=0.4" -ar 44100 -ac 1 -ab 64k src/audio/stub.mp3
```
Verify the file exists: `ls -lh src/audio/stub.mp3`

- [ ] **Step 2: Create `src/data/soundDefs.ts`**

```typescript
import stubUrl from '../audio/stub.mp3?url';

export type SoundCategory = 'music' | 'playerSfx' | 'enemySfx' | 'envSfx';

export interface SoundDef {
  category:   SoundCategory;
  baseVolume: number;
  loop:       boolean;
  url:        string;
}

export const SOUND_DEFS: Record<string, SoundDef> = {
  'music-menu':            { category: 'music',     loop: true,  baseVolume: 0.8, url: stubUrl },
  'music-game':            { category: 'music',     loop: true,  baseVolume: 0.8, url: stubUrl },
  'music-score':           { category: 'music',     loop: true,  baseVolume: 0.6, url: stubUrl },
  'player-jump':           { category: 'playerSfx', loop: false, baseVolume: 0.9, url: stubUrl },
  'player-land':           { category: 'playerSfx', loop: false, baseVolume: 0.7, url: stubUrl },
  'player-die':            { category: 'playerSfx', loop: false, baseVolume: 1.0, url: stubUrl },
  'enemy-kill':            { category: 'enemySfx',  loop: false, baseVolume: 0.9, url: stubUrl },
  'enemy-vulture-ambient': { category: 'enemySfx',  loop: true,  baseVolume: 0.4, url: stubUrl },
  'env-wall-rumble':       { category: 'envSfx',    loop: true,  baseVolume: 1.0, url: stubUrl },
};
```

- [ ] **Step 3: Commit**
```bash
git add src/audio/stub.mp3 src/data/soundDefs.ts
git commit -m "feat: stub audio file and sound definitions"
```

---

## Task 2: SaveData schema v4 (TDD)

**Files:**
- Modify: `src/systems/SaveData.ts`
- Modify: `src/systems/__tests__/SaveData.test.ts`

- [ ] **Step 1: Add import and test to `SaveData.test.ts`**

Add these imports at the top of the existing import block:
```typescript
import {
  getSoundSettings,
  setSoundVolume,
} from '../SaveData';
```

Append this test suite at the bottom of the file:
```typescript
describe('soundSettings – schema v4 migration', () => {
  it('migrates a v3 save to v4 and injects default soundSettings', () => {
    store['heap_save'] = JSON.stringify({
      schemaVersion: 3,
      balance: 100,
      upgrades: {},
      inventory: {},
      placed: {},
      selectedHeapId: '',
      playerGuid: 'test-guid',
      playerName: 'TestPlayer',
      highScores: {},
    });
    resetCacheForTests();
    const settings = getSoundSettings();
    expect(settings.master).toBe(1.0);
    expect(settings.music).toBe(0.7);
    expect(settings.playerSfx).toBe(1.0);
    expect(settings.enemySfx).toBe(0.8);
    expect(settings.envSfx).toBe(0.9);
    expect(getSchemaVersionForTests()).toBe(4);
  });

  it('preserves existing soundSettings when loading a v4 save', () => {
    store['heap_save'] = JSON.stringify({
      schemaVersion: 4,
      balance: 0,
      upgrades: {},
      inventory: {},
      placed: {},
      selectedHeapId: '',
      playerGuid: 'test-guid',
      playerName: 'TestPlayer',
      highScores: {},
      soundSettings: { master: 0.5, music: 0.3, playerSfx: 0.8, enemySfx: 0.6, envSfx: 0.7 },
    });
    resetCacheForTests();
    const settings = getSoundSettings();
    expect(settings.master).toBe(0.5);
    expect(settings.music).toBe(0.3);
  });

  it('setSoundVolume persists a single category change', () => {
    setSoundVolume('music', 0.2);
    resetCacheForTests();
    expect(getSoundSettings().music).toBe(0.2);
  });
});
```

- [ ] **Step 2: Run tests — expect failure**
```bash
npm test -- --reporter=verbose 2>&1 | grep -A 3 "soundSettings"
```
Expected: FAIL — `getSoundSettings` not exported.

- [ ] **Step 3: Update `src/systems/SaveData.ts`**

Change `CURRENT_SCHEMA` from `3` to `4`:
```typescript
const CURRENT_SCHEMA = 4;
```

Add the `SoundSettings` interface and default after the `PlacedItemSave` interface (around line 17):
```typescript
export interface SoundSettings {
  master:    number;
  music:     number;
  playerSfx: number;
  enemySfx:  number;
  envSfx:    number;
}

const DEFAULT_SOUND_SETTINGS: SoundSettings = {
  master:    1.0,
  music:     0.7,
  playerSfx: 1.0,
  enemySfx:  0.8,
  envSfx:    0.9,
};
```

Add `soundSettings` to the `RawSave` interface (after `verboseLogging`):
```typescript
soundSettings?: SoundSettings;
```

In `freshSave()`, add the field:
```typescript
function freshSave(): RawSave {
  return {
    schemaVersion:  CURRENT_SCHEMA,
    balance:        0,
    upgrades:       {},
    inventory:      {},
    placed:         {},
    selectedHeapId: '',
    playerGuid:     generateGuid(),
    playerName:     generateDefaultName(),
    highScores:     {},
    soundSettings:  { ...DEFAULT_SOUND_SETTINGS },
  };
}
```

In `migrate()`, replace the early-return branch (the `version === CURRENT_SCHEMA` block) with:
```typescript
if (version === CURRENT_SCHEMA) {
  return {
    schemaVersion:  CURRENT_SCHEMA,
    balance:        parsed.balance        ?? 0,
    upgrades:       parsed.upgrades       ?? {},
    inventory:      parsed.inventory      ?? {},
    placed:         parsed.placed         ?? {},
    selectedHeapId: parsed.selectedHeapId ?? '',
    playerGuid:     parsed.playerGuid     ?? generateGuid(),
    playerName:     parsed.playerName     ?? generateDefaultName(),
    gpgsPlayerId:   parsed.gpgsPlayerId,
    highScores:     parsed.highScores     ?? {},
    verboseLogging: parsed.verboseLogging,
    _legacyPlaced:  parsed._legacyPlaced,
    soundSettings:  parsed.soundSettings  ?? { ...DEFAULT_SOUND_SETTINGS },
  };
}
```

In the v1 migration block and v2→v3 migration block, add `soundSettings: { ...DEFAULT_SOUND_SETTINGS }` to each returned object.

Add the new exports at the bottom of `SaveData.ts` (before the test helpers section):
```typescript
// ── Sound settings ────────────────────────────────────────────────────────────

export function getSoundSettings(): SoundSettings {
  return { ...(load().soundSettings ?? DEFAULT_SOUND_SETTINGS) };
}

export function setSoundVolume(cat: keyof SoundSettings, v: number): void {
  const data = load();
  data.soundSettings = { ...(data.soundSettings ?? DEFAULT_SOUND_SETTINGS), [cat]: v };
  persist(data);
}
```

- [ ] **Step 4: Run tests — expect pass**
```bash
npm test -- --reporter=verbose 2>&1 | grep -E "soundSettings|PASS|FAIL" | head -20
```
Expected: all soundSettings tests PASS.

- [ ] **Step 5: Commit**
```bash
git add src/systems/SaveData.ts src/systems/__tests__/SaveData.test.ts
git commit -m "feat: SaveData schema v4 — soundSettings with migration"
```

---

## Task 3: AudioManager — pure math + singleton

**Files:**
- Create: `src/systems/AudioManager.ts`
- Create: `src/systems/__tests__/AudioManager.test.ts`

- [ ] **Step 1: Write `src/systems/__tests__/AudioManager.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { effectiveVolume, proximityVolume, proximityRate } from '../AudioManager';

describe('effectiveVolume', () => {
  it('multiplies base × category × master', () => {
    expect(effectiveVolume(0.9, 0.8, 1.0)).toBeCloseTo(0.72);
  });

  it('returns 0 when master is 0', () => {
    expect(effectiveVolume(1.0, 1.0, 0)).toBe(0);
  });

  it('clamps output to [0, 1]', () => {
    expect(effectiveVolume(2.0, 2.0, 2.0)).toBe(1);
  });
});

describe('proximityVolume', () => {
  it('returns 0 when t is 0', () => {
    expect(proximityVolume(0, 1.0, 1.0, 1.0)).toBe(0);
  });

  it('returns base × cat × master when t is 1', () => {
    expect(proximityVolume(1, 0.8, 0.9, 1.0)).toBeCloseTo(0.8 * 0.9 * 1.0);
  });

  it('uses t^0.7 curve (less than linear)', () => {
    const half = proximityVolume(0.5, 1.0, 1.0, 1.0);
    expect(half).toBeCloseTo(Math.pow(0.5, 0.7));
    expect(half).toBeGreaterThan(0.5); // t^0.7 > t for t in (0,1)
  });
});

describe('proximityRate', () => {
  it('returns 0.8 at t=0', () => {
    expect(proximityRate(0)).toBeCloseTo(0.8);
  });

  it('returns 1.3 at t=1', () => {
    expect(proximityRate(1)).toBeCloseTo(1.3);
  });

  it('returns 1.05 at t=0.5', () => {
    expect(proximityRate(0.5)).toBeCloseTo(1.05);
  });
});
```

- [ ] **Step 2: Run tests — expect failure**
```bash
npm test -- --reporter=verbose 2>&1 | grep -A 3 "AudioManager"
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/systems/AudioManager.ts`**

```typescript
import Phaser from 'phaser';
import { SOUND_DEFS, type SoundCategory } from '../data/soundDefs';
import { getSoundSettings, setSoundVolume } from './SaveData';

// ── Pure math — exported for unit testing ──────────────────────────────────────

export function effectiveVolume(base: number, category: number, master: number): number {
  return Math.min(1, base * category * master);
}

export function proximityVolume(t: number, base: number, category: number, master: number): number {
  return Math.pow(t, 0.7) * base * category * master;
}

export function proximityRate(t: number): number {
  return 0.8 + t * 0.5;
}

// ── AudioManager singleton ─────────────────────────────────────────────────────

type VolumeMap = Record<SoundCategory | 'master', number>;

class _AudioManager {
  private sm: Phaser.Sound.BaseSoundManager | null = null;
  private volumes: VolumeMap = {
    master: 1.0, music: 0.7, playerSfx: 1.0, enemySfx: 0.8, envSfx: 0.9,
  };
  private playing = new Map<string, Phaser.Sound.BaseSound>();
  private currentMusicKey: string | null = null;

  init(sm: Phaser.Sound.BaseSoundManager): void {
    this.sm = sm;
    const s = getSoundSettings();
    this.volumes = {
      master: s.master, music: s.music, playerSfx: s.playerSfx,
      enemySfx: s.enemySfx, envSfx: s.envSfx,
    };
  }

  play(key: string, opts?: { volume?: number }): void {
    if (!this.sm) return;
    const def = SOUND_DEFS[key];
    if (!def) return;

    if (def.category === 'music') {
      if (this.currentMusicKey && this.currentMusicKey !== key) {
        this.stop(this.currentMusicKey);
      }
      if (this.currentMusicKey === key) return; // already playing this track
      this.currentMusicKey = key;
    } else {
      this.stop(key); // stop duplicate before restarting
    }

    const vol = effectiveVolume(
      opts?.volume ?? def.baseVolume,
      this.volumes[def.category],
      this.volumes.master,
    );
    const sound = this.sm.add(key, { loop: def.loop, volume: vol });
    sound.play();
    this.playing.set(key, sound);

    if (!def.loop) {
      sound.once(Phaser.Sound.Events.COMPLETE, () => {
        this.playing.delete(key);
      });
    }
  }

  stop(key: string): void {
    const sound = this.playing.get(key);
    if (sound) {
      sound.stop();
      sound.destroy();
      this.playing.delete(key);
    }
    if (this.currentMusicKey === key) this.currentMusicKey = null;
  }

  stopAll(category?: SoundCategory): void {
    for (const [key, sound] of [...this.playing.entries()]) {
      const def = SOUND_DEFS[key];
      if (!category || def?.category === category) {
        sound.stop();
        sound.destroy();
        this.playing.delete(key);
        if (this.currentMusicKey === key) this.currentMusicKey = null;
      }
    }
  }

  setCategoryVolume(cat: SoundCategory | 'master', v: number): void {
    this.volumes[cat] = v;
    setSoundVolume(cat as keyof import('./SaveData').SoundSettings, v);
    for (const [key, sound] of this.playing.entries()) {
      const def = SOUND_DEFS[key];
      if (!def) continue;
      if (cat === 'master' || def.category === cat) {
        const newVol = effectiveVolume(def.baseVolume, this.volumes[def.category], this.volumes.master);
        sound.setVolume(newVol);
      }
    }
  }

  setWallProximity(t: number): void {
    if (!this.sm) return;
    const key = 'env-wall-rumble';
    const def = SOUND_DEFS[key];
    if (!def) return;

    if (t <= 0.01) {
      this.stop(key);
      return;
    }

    const vol = proximityVolume(t, def.baseVolume, this.volumes.envSfx, this.volumes.master);
    const rate = proximityRate(t);

    if (!this.playing.has(key)) {
      const sound = this.sm.add(key, { loop: true, volume: vol });
      sound.play();
      this.playing.set(key, sound);
    } else {
      const sound = this.playing.get(key)!;
      sound.setVolume(vol);
      if ('setRate' in sound) (sound as Phaser.Sound.WebAudioSound).setRate(rate);
    }
  }

  getVolumes(): VolumeMap {
    return { ...this.volumes };
  }
}

export const AudioManager = new _AudioManager();
```

- [ ] **Step 4: Run tests — expect pass**
```bash
npm test -- --reporter=verbose 2>&1 | grep -E "AudioManager|effectiveVolume|proximityVolume|proximityRate|PASS|FAIL" | head -20
```
Expected: all AudioManager tests PASS.

- [ ] **Step 5: Run full test suite and build**
```bash
npm test 2>&1 | tail -5
npm run build 2>&1 | tail -10
```
Expected: all tests pass, build succeeds.

- [ ] **Step 6: Commit**
```bash
git add src/systems/AudioManager.ts src/systems/__tests__/AudioManager.test.ts
git commit -m "feat: AudioManager singleton with volume math and wall proximity"
```

---

## Task 4: Load audio assets + init AudioManager

**Files:**
- Modify: `src/scenes/loadGameAssets.ts`
- Modify: `src/scenes/BootScene.ts`

- [ ] **Step 1: Add audio loading to `src/scenes/loadGameAssets.ts`**

Add import at the top of the file (alongside other imports):
```typescript
import { SOUND_DEFS } from '../data/soundDefs';
```

Add the audio loading block inside `loadGameAssets()`, before the `scene.load.start()` call at the bottom:
```typescript
  // ── Audio ────────────────────────────────────────────────────────────────────
  // Phaser deduplicates loads by key — safe to call repeatedly.
  const loadedAudioUrls = new Set<string>();
  for (const [key, def] of Object.entries(SOUND_DEFS)) {
    if (!loadedAudioUrls.has(def.url)) {
      scene.load.audio(key, def.url);
      loadedAudioUrls.add(def.url);
    } else {
      scene.load.audio(key, def.url);
    }
  }
```

Replace the above with a simpler version (the Set approach was over-engineered — Phaser handles dedup):
```typescript
  // ── Audio ────────────────────────────────────────────────────────────────────
  for (const [key, def] of Object.entries(SOUND_DEFS)) {
    scene.load.audio(key, def.url);
  }
```

- [ ] **Step 2: Add `AudioManager.init()` to `src/scenes/BootScene.ts`**

Add import at the top:
```typescript
import { AudioManager } from '../systems/AudioManager';
```

In `create()`, add the init call immediately after `generateAllTextures(this)` (line 27):
```typescript
    // Initialize audio manager — must run before any scene that plays sounds.
    AudioManager.init(this.sound);
```

- [ ] **Step 3: Run build to verify no type errors**
```bash
npm run build 2>&1 | tail -15
```
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**
```bash
git add src/scenes/loadGameAssets.ts src/scenes/BootScene.ts
git commit -m "feat: load audio assets and init AudioManager in BootScene"
```

---

## Task 5: Wall proximity rumble

**Files:**
- Modify: `src/systems/TrashWallManager.ts`
- Modify: `src/constants.ts`
- Modify: `src/scenes/GameScene.ts`
- Modify: `src/scenes/InfiniteGameScene.ts`

- [ ] **Step 1: Add public getter to `TrashWallManager.ts`**

Find the `isWarning = false;` line (around line 61) and add the getter directly below it:
```typescript
  /** True when wall is within def.warningDistance of the player. Read by GameScene (future audio). */
  isWarning = false;
  /** Current world Y of the wall top. Used by game scenes for proximity audio. */
  get currentWallY(): number { return this.wallY; }
```

- [ ] **Step 2: Add `MAX_WALL_AUDIBLE_DISTANCE` to `src/constants.ts`**

Add after the `ENEMY_CULL_DISTANCE` line (around line 96):
```typescript
export const MAX_WALL_AUDIBLE_DISTANCE = 1200; // px gap at which wall rumble starts
```

- [ ] **Step 3: Wire proximity in `src/scenes/GameScene.ts`**

Add import at the top of GameScene.ts:
```typescript
import { AudioManager } from '../systems/AudioManager';
import { MAX_WALL_AUDIBLE_DISTANCE } from '../constants';
```

In `update()`, find the existing line (around line 341):
```typescript
    this.trashWallManager.update(this.player.sprite.y, delta);
```
Add directly after it:
```typescript
    const wallGap = this.trashWallManager.currentWallY - this.player.sprite.y;
    const wallT = 1 - Math.min(1, Math.max(0, wallGap / MAX_WALL_AUDIBLE_DISTANCE));
    AudioManager.setWallProximity(wallT);
```

Add a `shutdown()` method to GameScene (add after the last method in the class):
```typescript
  shutdown(): void {
    AudioManager.stopAll();
  }
```

- [ ] **Step 4: Wire proximity in `src/scenes/InfiniteGameScene.ts`**

Add the same imports at the top:
```typescript
import { AudioManager } from '../systems/AudioManager';
import { MAX_WALL_AUDIBLE_DISTANCE } from '../constants';
```

In `update()`, find the existing line (around line 339):
```typescript
    this.trashWallManager.update(this.player.sprite.y, delta);
```
Add directly after it:
```typescript
    const wallGap = this.trashWallManager.currentWallY - this.player.sprite.y;
    const wallT = 1 - Math.min(1, Math.max(0, wallGap / MAX_WALL_AUDIBLE_DISTANCE));
    AudioManager.setWallProximity(wallT);
```

Add `shutdown()` method:
```typescript
  shutdown(): void {
    AudioManager.stopAll();
  }
```

- [ ] **Step 5: Run tests and build**
```bash
npm test 2>&1 | tail -5
npm run build 2>&1 | tail -10
```
Expected: all tests pass, build succeeds.

- [ ] **Step 6: Commit**
```bash
git add src/systems/TrashWallManager.ts src/constants.ts src/scenes/GameScene.ts src/scenes/InfiniteGameScene.ts
git commit -m "feat: wall proximity rumble — currentWallY getter and AudioManager.setWallProximity wired"
```

---

## Task 6: Scene music

**Files:**
- Modify: `src/scenes/MenuScene.ts`
- Modify: `src/scenes/GameScene.ts`
- Modify: `src/scenes/InfiniteGameScene.ts`
- Modify: `src/scenes/ScoreScene.ts`

- [ ] **Step 1: Wire music in `MenuScene.ts`**

Add import (alongside existing imports):
```typescript
import { AudioManager } from '../systems/AudioManager';
```

In `create()`, find `this.createSettingsButton();` and add the music call before it:
```typescript
    AudioManager.play('music-menu');
    this.createSettingsButton();
```

- [ ] **Step 2: Wire music in `GameScene.ts`**

`AudioManager` is already imported from Task 5. In `create()`, find the line where `this.trashWallManager` is assigned (around line 175) and add the music call just before it:
```typescript
    AudioManager.play('music-game');
    this.trashWallManager = new TrashWallManager(...
```

- [ ] **Step 3: Wire music in `InfiniteGameScene.ts`**

`AudioManager` is already imported from Task 5. In `create()`, find the `this.trashWallManager` assignment (around line 217) and add the music call just before it:
```typescript
    AudioManager.play('music-game');
    this.trashWallManager = new TrashWallManager(...
```

- [ ] **Step 4: Wire music in `ScoreScene.ts`**

Add import:
```typescript
import { AudioManager } from '../systems/AudioManager';
```

In `create()`, add at the very start of the method body (after any init lines, before `this.createBackground()`):
```typescript
    AudioManager.play('music-score');
```

- [ ] **Step 5: Run build**
```bash
npm run build 2>&1 | tail -10
```
Expected: build succeeds.

- [ ] **Step 6: Commit**
```bash
git add src/scenes/MenuScene.ts src/scenes/GameScene.ts src/scenes/InfiniteGameScene.ts src/scenes/ScoreScene.ts
git commit -m "feat: per-scene background music wired to AudioManager"
```

---

## Task 7: Player SFX

**Files:**
- Modify: `src/entities/Player.ts`
- Modify: `src/scenes/GameScene.ts`

- [ ] **Step 1: Add `wasOnGround` field and SFX to `src/entities/Player.ts`**

Add import at the top:
```typescript
import { AudioManager } from '../systems/AudioManager';
```

Add private field after `private controlsEnabled = true;` (around line 72):
```typescript
  private _wasOnGround = false;
```

In `update()`, find the landing reset block (around line 145):
```typescript
    // Landing resets air jump and wall jump counters, and refreshes coyote window
    if (onGround) {
      this.coyoteTimer        = 120;
```
Add the land sound detection just before the existing `if (onGround)` block:
```typescript
    if (onGround && !this._wasOnGround) {
      AudioManager.play('player-land');
    }
    this._wasOnGround = onGround;
```

Find the ground-jump block (around line 236):
```typescript
      if (canGroundJump) {
        this.momentumX = im.jumpVx !== 0 ? im.jumpVx : body.velocity.x;
        this.sprite.setVelocityX(this.momentumX);
        this.sprite.setVelocityY(PLAYER_JUMP_VELOCITY - this.jumpBoost);
        this.coyoteTimer = 0;
```
Add `AudioManager.play('player-jump');` immediately after `this.coyoteTimer = 0;`:
```typescript
        this.coyoteTimer = 0;
        AudioManager.play('player-jump');
```

Find the air-jump block (around line 241):
```typescript
      } else if (!onWallForJump && this.airJumpsRemaining > 0) {
        this.momentumX = im.jumpVx !== 0 ? im.jumpVx : body.velocity.x;
        this.sprite.setVelocityX(this.momentumX);
        this.sprite.setVelocityY(PLAYER_JUMP_VELOCITY - this.jumpBoost);
        this.airJumpsRemaining--;
```
Add `AudioManager.play('player-jump');` immediately after `this.airJumpsRemaining--;`:
```typescript
        this.airJumpsRemaining--;
        AudioManager.play('player-jump');
```

Find the wall-jump block (around line 250):
```typescript
    if (this.wallJumpEnabled && !onGround && jumpPressed && this.wallJumpsRemaining > 0) {
```
Find the `setVelocityY` call inside that block and add after `this.wallJumpsRemaining--;`:
```typescript
        this.wallJumpsRemaining--;
        AudioManager.play('player-jump');
```

- [ ] **Step 2: Wire `player-die` in `src/scenes/GameScene.ts`**

`AudioManager` is already imported. Find the `onKill` callback passed to `TrashWallManager` (around line 175):
```typescript
    this.trashWallManager = new TrashWallManager(this, TRASH_WALL_DEF, () => {
      this.player.freeze();
```
Add the die sound before `this.player.freeze()`:
```typescript
    this.trashWallManager = new TrashWallManager(this, TRASH_WALL_DEF, () => {
      AudioManager.play('player-die');
      this.player.freeze();
```

- [ ] **Step 3: Run build**
```bash
npm run build 2>&1 | tail -10
```
Expected: build succeeds.

- [ ] **Step 4: Commit**
```bash
git add src/entities/Player.ts src/scenes/GameScene.ts
git commit -m "feat: player SFX — jump, land, die"
```

---

## Task 8: Enemy SFX

**Files:**
- Modify: `src/scenes/GameScene.ts`
- Modify: `src/systems/EnemyManager.ts`

- [ ] **Step 1: Wire `enemy-kill` in `src/scenes/GameScene.ts`**

Find the stomp callback (around line 552 — the function passed to the physics overlap that handles stomp reward):
```typescript
    const stompX = e.x;
    const stompY = e.y;
```
Add `AudioManager.play('enemy-kill');` immediately before `const stompX`:
```typescript
      AudioManager.play('enemy-kill');
      const stompX = e.x;
      const stompY = e.y;
```

- [ ] **Step 2: Add vulture ambient tracking to `src/systems/EnemyManager.ts`**

Add import at the top:
```typescript
import { AudioManager } from './AudioManager';
```

Add a private helper method to count active vultures (ghosts) — add it to the private section of the class (after `trySpawn`):
```typescript
  private ghostCount(): number {
    let n = 0;
    for (const rt of this.runtime.values()) {
      if (rt.kind === 'ghost') n++;
    }
    return n;
  }
```

In `trySpawn()`, find where the enemy is added to the runtime map and the DESTROY listener is set up (around lines 281–285):
```typescript
    this.runtime.set(enemy.sprite, rt);
    // External destroys (stomp, scene shutdown) bypass our cull loop;
    // keep the runtime Map from leaking by listening for the destroy event.
    enemy.sprite.once(Phaser.GameObjects.Events.DESTROY, () => {
      this.runtime.delete(enemy.sprite);
```

After `this.runtime.set(enemy.sprite, rt);`, add:
```typescript
    this.runtime.set(enemy.sprite, rt);
    if (def.kind === 'ghost' && this.ghostCount() === 1) {
      AudioManager.play('enemy-vulture-ambient');
    }
```

Inside the DESTROY listener, add after `this.runtime.delete(enemy.sprite)`:
```typescript
    enemy.sprite.once(Phaser.GameObjects.Events.DESTROY, () => {
      this.runtime.delete(enemy.sprite);
      if (rt.kind === 'ghost' && this.ghostCount() === 0) {
        AudioManager.stop('enemy-vulture-ambient');
      }
```

Note: `AudioManager.stop` needs to be exposed — add it to the public API in `AudioManager.ts` (it was already included in the implementation from Task 3, so this is just a reminder to verify it's exported via the singleton instance).

- [ ] **Step 3: Run tests and build**
```bash
npm test 2>&1 | tail -5
npm run build 2>&1 | tail -10
```
Expected: all tests pass, build succeeds.

- [ ] **Step 4: Commit**
```bash
git add src/scenes/GameScene.ts src/systems/EnemyManager.ts
git commit -m "feat: enemy SFX — kill sound and vulture ambient loop"
```

---

## Task 9: Tabbed settings panel

**Files:**
- Modify: `src/scenes/MenuScene.ts`

This task refactors `createSettingsButton()` to use two tab containers. The existing Dev content (coins button, reset button, analytics toggle) moves into the Dev tab. A new Sounds tab container is added but left empty — sliders are wired in Task 10.

- [ ] **Step 1: Refactor `createSettingsButton()` in `src/scenes/MenuScene.ts`**

Replace the entire `createSettingsButton()` method body with the tabbed version below. The panel height increases from 330 to 420 to fit the slider rows that come in Task 10.

```typescript
  private createSettingsButton(): void {
    const bx = this.scale.width - 22;
    const by = this.scale.height - 22;
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;

    // ── Gear button ──────────────────────────────────────────────────────────
    const btnGfx = this.add.graphics().setDepth(20);
    btnGfx.fillStyle(0x000000, 0.65);
    btnGfx.fillCircle(bx, by, 14);
    btnGfx.lineStyle(2, 0x8899bb, 1);
    btnGfx.strokeCircle(bx, by, 14);
    this.add.text(bx, by, '⚙', { fontSize: '16px', color: '#ddddff' }).setOrigin(0.5).setDepth(20);
    const hitZone = this.add.zone(bx, by, 36, 36).setDepth(20).setInteractive({ useHandCursor: true });

    // ── Overlay + panel ───────────────────────────────────────────────────────
    const overlayBg = this.add.rectangle(cx, cy, this.scale.width, this.scale.height, 0x000000, 0.72)
      .setDepth(30).setVisible(false).setInteractive();
    const PANEL_W = 360;
    const PANEL_H = 420;
    const panel = this.add.rectangle(cx, cy, PANEL_W, PANEL_H, 0x0d0d20)
      .setDepth(31).setVisible(false).setStrokeStyle(2, 0x4455aa);

    const title = this.add.text(cx, cy - PANEL_H / 2 + 22, 'SETTINGS', {
      fontSize: '22px', color: '#ffffff', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(32).setVisible(false);

    const closeBtn = this.add.text(cx + PANEL_W / 2 - 20, cy - PANEL_H / 2 + 14, '✕', {
      fontSize: '20px', color: '#aaaaaa',
    }).setOrigin(0.5).setDepth(32).setVisible(false).setInteractive({ useHandCursor: true });

    // ── Tab bar ───────────────────────────────────────────────────────────────
    const TAB_Y = cy - PANEL_H / 2 + 52;
    const TAB_W = 140;
    const TAB_H = 32;

    const soundsTabBg   = this.add.rectangle(cx - TAB_W / 2 - 4, TAB_Y, TAB_W, TAB_H, 0x2244aa).setDepth(32).setVisible(false);
    const soundsTabText = this.add.text(cx - TAB_W / 2 - 4, TAB_Y, 'Sounds', { fontSize: '14px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(33).setVisible(false);
    const devTabBg      = this.add.rectangle(cx + TAB_W / 2 + 4, TAB_Y, TAB_W, TAB_H, 0x1a1a2e).setDepth(32).setVisible(false);
    const devTabText    = this.add.text(cx + TAB_W / 2 + 4, TAB_Y, 'Dev', { fontSize: '14px', color: '#888888' }).setOrigin(0.5).setDepth(33).setVisible(false);

    // ── Tab containers ────────────────────────────────────────────────────────
    const CONTENT_TOP = TAB_Y + TAB_H / 2 + 12;

    // Dev tab content (existing items, repositioned relative to CONTENT_TOP)
    const coinBg = this.add.rectangle(cx, CONTENT_TOP + 24, 260, 44, 0x1a5c1a)
      .setDepth(32).setVisible(false).setStrokeStyle(2, 0x44ff44).setInteractive({ useHandCursor: true });
    const coinLabel = this.add.text(cx, CONTENT_TOP + 24, '+ 500 Coins', {
      fontSize: '18px', color: '#aaffaa', fontStyle: 'bold', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(33).setVisible(false);

    const resetBg = this.add.rectangle(cx, CONTENT_TOP + 88, 260, 52, 0x881111)
      .setDepth(32).setVisible(false).setStrokeStyle(2, 0xff4444).setInteractive({ useHandCursor: true });
    const resetLabel = this.add.text(cx, CONTENT_TOP + 88, 'Reset All Data', {
      fontSize: '20px', color: '#ffffff', fontStyle: 'bold', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(33).setVisible(false);
    const resetWarning = this.add.text(cx, CONTENT_TOP + 144, 'Clears all coins, upgrades\nand placed blocks.', {
      fontSize: '14px', color: '#aa8888', align: 'center',
    }).setOrigin(0.5).setDepth(32).setVisible(false);

    let analyticsEnabled = getVerboseLogging();
    const analyticsBg = this.add.rectangle(cx, CONTENT_TOP + 202, 260, 48, 0x1a3a1a)
      .setDepth(32).setVisible(false).setStrokeStyle(2, 0x44aa44).setInteractive({ useHandCursor: true });
    const analyticsCheckbox = this.add.text(cx - 110, CONTENT_TOP + 202, analyticsEnabled ? '☑' : '☐', {
      fontSize: '20px', color: '#44ff44', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(33).setVisible(false);
    const analyticsLabel = this.add.text(cx - 35, CONTENT_TOP + 194, 'Send anonymous\ngameplay analytics', {
      fontSize: '13px', color: '#aaffaa',
    }).setOrigin(0, 0.5).setDepth(33).setVisible(false);
    const analyticsHint = this.add.text(cx - 35, CONTENT_TOP + 211, 'Errors are always reported.', {
      fontSize: '11px', color: '#88aa88',
    }).setOrigin(0, 0.5).setDepth(33).setVisible(false);

    // Sounds tab content — populated in Task 10
    const soundsPlaceholder = this.add.text(cx, CONTENT_TOP + 80, '(Volume sliders coming soon)', {
      fontSize: '14px', color: '#666688', align: 'center',
    }).setOrigin(0.5).setDepth(33).setVisible(false);

    // ── Tab switching ─────────────────────────────────────────────────────────
    const devItems    = [coinBg, coinLabel, resetBg, resetLabel, resetWarning, analyticsBg, analyticsCheckbox, analyticsLabel, analyticsHint];
    const soundsItems = [soundsPlaceholder];

    const showSoundsTab = () => {
      soundsTabBg.setFillStyle(0x2244aa);   soundsTabText.setColor('#ffffff').setFontStyle('bold');
      devTabBg.setFillStyle(0x1a1a2e);      devTabText.setColor('#888888').setFontStyle('normal');
      devItems.forEach(o => o.setVisible(false));
      soundsItems.forEach(o => o.setVisible(true));
    };
    const showDevTab = () => {
      devTabBg.setFillStyle(0x2244aa);      devTabText.setColor('#ffffff').setFontStyle('bold');
      soundsTabBg.setFillStyle(0x1a1a2e);  soundsTabText.setColor('#888888').setFontStyle('normal');
      soundsItems.forEach(o => o.setVisible(false));
      devItems.forEach(o => o.setVisible(true));
    };

    soundsTabBg.setInteractive({ useHandCursor: true }).on('pointerup', showSoundsTab);
    soundsTabText.setInteractive({ useHandCursor: true }).on('pointerup', showSoundsTab);
    devTabBg.setInteractive({ useHandCursor: true }).on('pointerup', showDevTab);
    devTabText.setInteractive({ useHandCursor: true }).on('pointerup', showDevTab);

    // ── Wire existing Dev tab buttons ─────────────────────────────────────────
    coinBg.on('pointerup', () => {
      addBalance(500);
      this.balanceText.setText(`${getBalance()} coins`);
    });

    analyticsBg.on('pointerup', () => {
      analyticsEnabled = !analyticsEnabled;
      setVerboseLogging(analyticsEnabled);
      getLogger().setVerbose(analyticsEnabled);
      analyticsCheckbox.setText(analyticsEnabled ? '☑' : '☐');
    });

    // ── Open / close ──────────────────────────────────────────────────────────
    const alwaysVisible = [overlayBg, panel, title, closeBtn, soundsTabBg, soundsTabText, devTabBg, devTabText];

    const open = () => {
      alwaysVisible.forEach(o => o.setVisible(true));
      showSoundsTab(); // default to Sounds tab on open
    };
    const close = () => {
      alwaysVisible.forEach(o => o.setVisible(false));
      devItems.forEach(o => o.setVisible(false));
      soundsItems.forEach(o => o.setVisible(false));
      this.resetConfirmed = false;
      resetLabel.setText('Reset All Data');
      resetBg.setFillStyle(0x881111);
      resetWarning.setText('Clears all coins, upgrades\nand placed blocks.').setColor('#aa8888');
    };

    hitZone.on('pointerup', open);
    overlayBg.on('pointerup', close);
    closeBtn.on('pointerup', close);

    if (this._forceSettingsOpen) this.time.delayedCall(2200, open);

    resetBg.on('pointerup', () => {
      if (!this.resetConfirmed) {
        this.resetConfirmed = true;
        resetLabel.setText('Tap again to confirm');
        resetBg.setFillStyle(0xcc2222);
        resetWarning.setText('This cannot be undone.').setColor('#ff6666');
      } else {
        resetAllData();
        close();
        this.scene.restart();
      }
    });
  }
```

- [ ] **Step 2: Run build to check for type errors**
```bash
npm run build 2>&1 | tail -15
```
Expected: build succeeds.

- [ ] **Step 3: Scene preview — check tab layout**

Make sure `npm run dev` is running in a separate terminal, then:
```bash
npm run scene-preview -- MenuScene '{"forceSettingsOpen":true}' pixel7
```
Open `screenshots/preview.png` and verify:
- Settings panel opens with two tabs: Sounds (active/highlighted) and Dev
- Sounds tab shows the placeholder text
- Panel is taller than before

- [ ] **Step 4: Scene preview — check Dev tab**
```bash
npm run scene-preview -- MenuScene '{"forceSettingsOpen":true}' iphone14
```
Open `screenshots/preview.png` and verify the panel fits at iPhone 14 dimensions.

- [ ] **Step 5: Commit**
```bash
git add src/scenes/MenuScene.ts
git commit -m "feat: tabbed settings panel — Sounds and Dev tabs"
```

---

## Task 10: Volume sliders in Sounds tab

**Files:**
- Modify: `src/scenes/MenuScene.ts`

- [ ] **Step 1: Add AudioManager import to `MenuScene.ts`**

If not already imported from Task 6, add:
```typescript
import { AudioManager } from '../systems/AudioManager';
import type { SoundCategory } from '../data/soundDefs';
```

- [ ] **Step 2: Add private slider helper method to MenuScene class**

Add this private method to MenuScene (before `createSettingsButton()`):

```typescript
  private createVolumeSlider(
    x: number, y: number, labelText: string,
    cat: SoundCategory | 'master', initialValue: number, depth: number,
  ): Phaser.GameObjects.GameObject[] {
    const TRACK_W = 220;
    const TRACK_H = 6;
    const THUMB_R = 9;

    const label = this.add.text(x - TRACK_W / 2, y - 14, labelText, {
      fontSize: '13px', color: '#aaaacc',
    }).setOrigin(0, 0.5).setDepth(depth);

    const track = this.add.rectangle(x, y, TRACK_W, TRACK_H, 0x334466)
      .setDepth(depth);

    const fill = this.add.rectangle(
      x - TRACK_W / 2 + (TRACK_W * initialValue) / 2, y, TRACK_W * initialValue, TRACK_H, 0x4466cc,
    ).setDepth(depth);

    const thumb = this.add.circle(x - TRACK_W / 2 + TRACK_W * initialValue, y, THUMB_R, 0x6688ff)
      .setDepth(depth + 1).setInteractive({ draggable: true, useHandCursor: true });

    const updateThumb = (newValue: number) => {
      const clamped = Math.max(0, Math.min(1, newValue));
      const thumbX  = x - TRACK_W / 2 + TRACK_W * clamped;
      thumb.setPosition(thumbX, y);
      fill.setPosition(x - TRACK_W / 2 + (TRACK_W * clamped) / 2, y);
      fill.setSize(TRACK_W * clamped, TRACK_H);
      AudioManager.setCategoryVolume(cat, clamped);
    };

    this.input.setDraggable(thumb);
    thumb.on('drag', (_ptr: Phaser.Input.Pointer, dragX: number) => {
      const newValue = (dragX - (x - TRACK_W / 2)) / TRACK_W;
      updateThumb(newValue);
    });

    return [label, track, fill, thumb];
  }
```

- [ ] **Step 3: Replace the Sounds tab placeholder with sliders in `createSettingsButton()`**

Inside `createSettingsButton()`, find:
```typescript
    // Sounds tab content — populated in Task 10
    const soundsPlaceholder = this.add.text(cx, CONTENT_TOP + 80, '(Volume sliders coming soon)', {
      fontSize: '14px', color: '#666688', align: 'center',
    }).setOrigin(0.5).setDepth(33).setVisible(false);
```

Replace with:
```typescript
    // Sounds tab content — 5 volume sliders
    const vols = AudioManager.getVolumes();
    const SLIDER_DEPTH = 33;
    const SLIDER_X = cx;
    const DIVIDER_Y = CONTENT_TOP + 66;

    const masterSliderParts = this.createVolumeSlider(SLIDER_X, CONTENT_TOP + 24, 'MASTER', 'master', vols.master, SLIDER_DEPTH);
    const divider = this.add.rectangle(cx, DIVIDER_Y, 280, 1, 0x334466).setDepth(SLIDER_DEPTH).setVisible(false);
    const musicSliderParts   = this.createVolumeSlider(SLIDER_X, CONTENT_TOP + 96,  'Music',        'music',     vols.music,     SLIDER_DEPTH);
    const playerSliderParts  = this.createVolumeSlider(SLIDER_X, CONTENT_TOP + 150, 'Player SFX',   'playerSfx', vols.playerSfx, SLIDER_DEPTH);
    const enemySliderParts   = this.createVolumeSlider(SLIDER_X, CONTENT_TOP + 204, 'Enemy SFX',    'enemySfx',  vols.enemySfx,  SLIDER_DEPTH);
    const envSliderParts     = this.createVolumeSlider(SLIDER_X, CONTENT_TOP + 258, 'Environment',  'envSfx',    vols.envSfx,    SLIDER_DEPTH);

    const soundsItems = [
      divider,
      ...masterSliderParts, ...musicSliderParts, ...playerSliderParts,
      ...enemySliderParts, ...envSliderParts,
    ];
```

- [ ] **Step 4: Run build**
```bash
npm run build 2>&1 | tail -10
```
Expected: build succeeds.

- [ ] **Step 5: Scene preview — check Sounds tab with sliders**

```bash
npm run scene-preview -- MenuScene '{"forceSettingsOpen":true}' pixel7
```
Open `screenshots/preview.png` and verify:
- Sounds tab shows MASTER slider at top
- Thin divider line below MASTER
- Four sub-category sliders below (Music, Player SFX, Enemy SFX, Environment)
- Sliders are spaced evenly within the panel

- [ ] **Step 6: Scene preview — check on iphone14**
```bash
npm run scene-preview -- MenuScene '{"forceSettingsOpen":true}' iphone14
```
Verify nothing clips out of the panel on the smaller screen.

- [ ] **Step 7: Full test suite and build**
```bash
npm test 2>&1 | tail -5
npm run build 2>&1 | tail -10
```
Expected: all tests pass, build succeeds.

- [ ] **Step 8: Commit**
```bash
git add src/scenes/MenuScene.ts
git commit -m "feat: volume sliders in Sounds tab — master + 4 category controls"
```

---

## Self-review checklist

- [x] Spec coverage: AudioManager core ✓, data model ✓, wall proximity ✓, scene music ✓, player SFX ✓, enemy SFX ✓, tabbed panel ✓, volume sliders ✓
- [x] No TBDs or placeholders in any task
- [x] Type consistency: `SoundCategory` used consistently, `effectiveVolume`/`proximityVolume`/`proximityRate` exported from AudioManager and match test imports
- [x] `AudioManager.stop` is part of the singleton (Task 3) and used in Task 8 (EnemyManager)
- [x] `setSoundVolume` accepts `keyof SoundSettings` — the `SoundCategory | 'master'` union maps correctly since `SoundSettings` fields are exactly those keys
- [x] Scene preview steps use `forceSettingsOpen:true` param which exists from the squishbugs branch
