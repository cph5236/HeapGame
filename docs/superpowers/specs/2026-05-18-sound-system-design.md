# Sound System Design

**Date:** 2026-05-18
**Branch:** feature/SoundSystem (new)
**Status:** Spec — awaiting implementation plan

---

## Overview

Add a categorized audio system to HeapGame with per-category volume controls, persistent settings, and a distance-based trash wall proximity rumble. The system uses Phaser 3's built-in `SoundManager` wrapped in a custom `AudioManager` singleton. No new runtime dependencies.

---

## Architecture

### AudioManager (`src/systems/AudioManager.ts`)

Module singleton — same pattern as `SaveData`. Holds one reference to Phaser's `SoundManager`, obtained via `AudioManager.init(soundManager)` called once in `BootScene` before any other scene starts.

#### Internal state

```typescript
interface AudioState {
  soundManager: Phaser.Sound.BaseSoundManager;
  volumes: Record<SoundCategory | 'master', number>;
  playing: Map<string, Phaser.Sound.BaseSound>;  // key → active sound handle
  wallRumblePlaying: boolean;
}
```

#### Public API

```typescript
AudioManager.init(soundManager: Phaser.Sound.BaseSoundManager): void
AudioManager.play(key: string, opts?: { volume?: number }): void
AudioManager.stop(key: string): void
AudioManager.stopAll(category?: SoundCategory): void
AudioManager.setCategoryVolume(cat: SoundCategory | 'master', v: number): void
AudioManager.setWallProximity(t: number): void   // t ∈ [0..1]
AudioManager.getVolumes(): Record<SoundCategory | 'master', number>
```

#### Volume calculation

Every sound's effective volume is:

```
effectiveVolume = baseVolume × categoryVolume × masterVolume
```

`setCategoryVolume()` iterates all currently-playing sounds in that category and calls `sound.setVolume(effectiveVolume)` immediately, then writes the new value to `SaveData`.

#### Duplicate prevention

`play()` checks the `playing` map before starting. If a non-looping sound with that key is already playing, it is stopped first and restarted (natural for repeated SFX). Music (category `music`) is exclusive: playing any music key stops the current music first.

---

## Data Model

### Sound definitions (`src/data/soundDefs.ts`)

Single source of truth for every sound in the game.

```typescript
export type SoundCategory = 'music' | 'playerSfx' | 'enemySfx' | 'envSfx';

export interface SoundDef {
  category:   SoundCategory;
  baseVolume: number;   // [0..1], before category × master scaling
  loop:       boolean;
  url:        string;   // replace this path when a real file is available
}
```

#### Initial sound set

| Key | Category | Loop | Notes |
|---|---|---|---|
| `music-menu` | `music` | yes | MenuScene background |
| `music-game` | `music` | yes | GameScene + InfiniteGameScene |
| `music-score` | `music` | yes | ScoreScene |
| `player-jump` | `playerSfx` | no | — |
| `player-land` | `playerSfx` | no | — |
| `player-die` | `playerSfx` | no | — |
| `enemy-kill` | `enemySfx` | no | Played on stomp |
| `enemy-vulture-ambient` | `enemySfx` | yes | While vulture is on screen |
| `env-wall-rumble` | `envSfx` | yes | Proximity-driven; see below |

All stub entries point to a single bundled file: `src/audio/stub.mp3` — one second of near-silence with a faint blip, audible enough to confirm the system is wired but unobtrusive. Replace individual `url` fields as real files arrive; no other code changes needed.

### SaveData changes

Schema version bump: **3 → 4**.

New field added to `RawSave`:

```typescript
soundSettings: {
  master:    number;  // [0..1]
  music:     number;
  playerSfx: number;
  enemySfx:  number;
  envSfx:    number;
}
```

Migration from v3: inject defaults `{ master: 1.0, music: 0.7, playerSfx: 1.0, enemySfx: 0.8, envSfx: 0.9 }`.

`AudioManager.init()` reads these from `SaveData` on startup. `setCategoryVolume()` writes back immediately — settings survive without an explicit save button.

New SaveData exports:
```typescript
getSoundSettings(): SoundSettings
setSoundSettings(settings: Partial<SoundSettings>): void
```

### Asset loading

`loadGameAssets.ts` gets one new block that iterates `SOUND_DEFS` and calls `scene.load.audio(key, def.url)` for each entry. Audio loads in the same existing pipeline alongside textures. No change to the loading sequence or ready-flag logic.

---

## Wall Proximity Rumble

`GameScene.update()` and `InfiniteGameScene.update()` each compute a proximity scalar from existing wall/player position data and forward it to `AudioManager`:

```typescript
// In update() — both GameScene and InfiniteGameScene
const gap = wallY - playerY;
const t = 1 - Math.min(1, Math.max(0, gap / MAX_WALL_AUDIBLE_DISTANCE));
AudioManager.setWallProximity(t);
```

`MAX_WALL_AUDIBLE_DISTANCE` added to `constants.ts`, initial value `1200` (px). Tunable without code changes.

Inside `AudioManager.setWallProximity(t)`:

- **t ≤ 0.01** — stop `env-wall-rumble` if playing
- **t > 0.01 and not playing** — start `env-wall-rumble` looping
- **Volume:** `t^0.7 × baseVolume × envSfxVolume × masterVolume` — exponential curve so the sound is barely audible at distance and rises sharply near the kill zone
- **Playback rate:** `0.8 + t × 0.5` — low slow rumble far away, faster grind up close

`TrashWallManager` stays pure math — no audio coupling.

---

## Settings UI — Tabbed Settings Panel

The existing settings overlay in `MenuScene` is restructured into a tabbed panel with two tabs: **Sounds** and **Dev**.

### Tab bar

Two styled buttons along the top of the panel. Active tab has a highlighted background; inactive is muted. Clicking swaps which content container is visible (instant, no animation). Tab state is ephemeral — resets to **Sounds** each time the panel opens.

```
┌────────────────────────────────┐
│  [ Sounds ]  [ Dev ]           │  ← tab bar
├────────────────────────────────┤
│                                │
│  (active tab content)          │
│                                │
└────────────────────────────────┘
```

### Sounds tab

Five volume rows, stacked vertically:

```
MASTER        [━━━━━━━━●━━]
─────────────────────────────
Music         [━━━━━━●━━━━]
Player SFX    [━━━━━━━━━━●]
Enemy SFX     [━━━━━━━●━━━]
Environment   [━━━━━━━━●━━]
```

Master sits above a visual divider from the four sub-categories. Each row is a label + a drag slider built from Phaser primitives (track rectangle + draggable thumb). On drag: compute `[0..1]` from thumb x, call `AudioManager.setCategoryVolume(cat, v)`, redraw thumb. Changes are live and persisted immediately.

### Dev tab

Contains the existing settings content (verbose logging toggle, analytics toggle, reset data). No functional change — just relocated into the tab container.

### Panel height

Increased to fit five slider rows in the Sounds tab. Dev tab is shorter and will have whitespace at the bottom.

---

## Scene Integration Points

| Scene | Action |
|---|---|
| `BootScene` | `AudioManager.init(this.sound)` before any other scene starts |
| `MenuScene` | `AudioManager.play('music-menu')` in `create()`; settings panel wired to `setCategoryVolume` |
| `GameScene` | `AudioManager.play('music-game')` in `create()`; wall proximity in `update()`; player/enemy SFX at event sites |
| `InfiniteGameScene` | Same as GameScene |
| `ScoreScene` | `AudioManager.play('music-score')` in `create()` |
| `Player.ts` | `AudioManager.play('player-jump'/'player-land'/'player-die')` at existing event sites |
| `EnemyManager.ts` | `AudioManager.play('enemy-kill')` on stomp; `enemy-vulture-ambient` start/stop with vulture spawn/cull |
| `GameScene` / `InfiniteGameScene` shutdown | `AudioManager.stopAll()` — clears wall rumble and any looping SFX when leaving the game scene. Music for the next scene is stopped automatically by the exclusive-play rule when the destination scene calls `play()`. |

---

## Testing

- Unit tests for `AudioManager` volume math (effective volume formula, category update, proximity curve) using a mock `SoundManager`
- Unit test for SaveData v3→v4 migration (defaults injected correctly)
- No Playwright tests needed — audio is not visually verifiable; manual smoke test on device after stub sounds confirm wiring

---

## Out of Scope

- Per-enemy-instance spatial (3D) audio — proximity is wall-only for now
- Pitch variation on SFX (randomized slight pitch shift on repeated sounds)
- Sound for dash, ladder, checkpoint, portal — these are empty slots in soundDefs; add `url` + call site when files are ready
- Pause/resume audio on app backgrounding (Capacitor lifecycle) — Phaser handles this automatically via the Page Visibility API
