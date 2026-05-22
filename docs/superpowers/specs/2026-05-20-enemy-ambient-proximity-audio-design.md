# Enemy Ambient Proximity Audio — Design Spec
Date: 2026-05-20

## Goal

Two improvements to enemy ambient audio:

1. **Rat chirps are intermittent** — currently `enemy-rat-ambient` loops constantly whenever a rat is present. Change it to a one-shot that fires on a random timer so it sounds like occasional skittering rather than a constant drone.
2. **All enemy ambient sounds fall off with distance** — vulture loop volume and rat chirp volume scale down as the player moves away from the nearest enemy of that type.

## Approach

Extend the existing wall-proximity pattern (`setWallProximity` / `proximityVolume`) to cover enemy ambients. A 100ms-throttled block inside `EnemyManager.update()` computes distance to nearest enemy of each type and drives AudioManager accordingly.

---

## Data Layer (`soundDefs.ts`)

### SoundDef interface — three new optional fields

```typescript
maxAudibleDistancePx?: number;     // beyond this distance → volume 0 (loop stopped)
fullVolumeDistancePx?: number;     // closer than this → full baseVolume (default: 0)
playIntervalMs?: [number, number]; // [min, max] ms — for intermittent one-shots
```

### Updated entries

| Key | Change |
|-----|--------|
| `enemy-vulture-ambient` | Add `maxAudibleDistancePx: 700, fullVolumeDistancePx: 150` |
| `enemy-rat-ambient` | Change `loop: false`, add `maxAudibleDistancePx: 450, fullVolumeDistancePx: 80, playIntervalMs: [3000, 8000]` |

All distance and interval values are data — tune in `soundDefs.ts` without touching logic.

---

## AudioManager (`AudioManager.ts`)

### `setLoopProximity(key: string, t: number): void`

Generalized version of the existing `setWallProximity` — no playback rate change. Manages the full lifecycle of a looping ambient:

- `t ≤ 0.01` → stop and destroy the sound instance if playing
- `t > 0.01` and not playing → cache-guard check, then add + play with computed volume
- `t > 0.01` and already playing → update volume only

Volume formula: `proximityVolume(t, def.baseVolume, volumes[category], volumes.master)` (the existing exported pure function, `Math.pow(t, 0.7) * base * cat * master`).

### `playProximate(key: string, t: number): void`

Fires a one-shot at proximity-scaled volume. No-ops when `t ≤ 0.01`.

Internally computes `tScaledBase = Math.pow(t, 0.7) * def.baseVolume` and passes it as `opts.volume` to the existing `play()`. Because `play()` then applies `effectiveVolume(tScaledBase, category, master)`, the final result equals `proximityVolume(t, base, cat, master)` — the same power-curve used for the wall and loop sounds.

---

## EnemyManager (`EnemyManager.ts`)

### Signature change

```typescript
update(_camTop: number, camBottom: number, playerX: number, playerY: number): void
```

### New private fields

```typescript
private proximityNextAt = 0;
private ratChirpAt      = 0;
```

### Throttled proximity block (100ms)

Added at the top of `update()`, before the cull/movement loop:

```
if (now >= proximityNextAt):
  proximityNextAt = now + 100

  // ── Vulture loop ──
  find nearest ghost sprite to (playerX, playerY) by euclidean distance
  t = distanceToProximityT(dist, def.fullVolumeDistancePx, def.maxAudibleDistancePx)
  AudioManager.setLoopProximity('enemy-vulture-ambient', t)
  // t=0 when no ghosts or all out of range → stops the loop

  // ── Rat chirp ──
  if ratCount > 0 and now >= ratChirpAt:
    find nearest percher sprite to (playerX, playerY)
    t = distanceToProximityT(dist, ...)
    AudioManager.playProximate('enemy-rat-ambient', t)
    ratChirpAt = now + Phaser.Math.Between(def.playIntervalMs[0], def.playIntervalMs[1])
  // if ratCount === 0: chirp is not scheduled; ratChirpAt stays in the past until rats return
```

### `distanceToProximityT` helper (private)

```
dist <= fullVolumeDistancePx  → t = 1
dist >= maxAudibleDistancePx  → t = 0
otherwise                     → t = 1 - (dist - full) / (max - full)
```

Plain linear lerp; the power curve lives in `proximityVolume`.

### Removed calls

The following are removed because `setLoopProximity` and the rat timer fully own these sounds now:

- `AudioManager.play('enemy-vulture-ambient')` in `trySpawn`
- `AudioManager.stop('enemy-vulture-ambient')` in the destroy callback
- `AudioManager.play('enemy-rat-ambient')` in `trySpawn`
- `AudioManager.stop('enemy-rat-ambient')` in the destroy callback

The `ghostCount()` and `ratCount()` private methods are kept — they're still used by the throttled block.

---

## Callers (`GameScene.ts`, `InfiniteGameScene.ts`)

Pass player position into `update()`:

**GameScene** (line ~350):
```typescript
this.enemyManager.update(camTop, camBottom, this.player.sprite.x, this.player.sprite.y);
```

**InfiniteGameScene** (inside the `for (const em of this.enemyManagers)` loop):
```typescript
em.update(camTop, camBot, this.player.sprite.x, this.player.sprite.y);
```

---

## What Is Not Changing

- `setWallProximity` — unchanged; wall rumble keeps its rate-shift behavior
- `effectiveVolume`, `proximityVolume`, `proximityRate` pure functions — unchanged
- Music, playerSfx, envSfx categories — no changes
- One-shot SFX like `enemy-kill` — no falloff (happens at player position anyway)

---

## Tunable Values (in `soundDefs.ts`)

| Sound | `maxAudibleDistancePx` | `fullVolumeDistancePx` | `playIntervalMs` |
|-------|----------------------|----------------------|-----------------|
| `enemy-vulture-ambient` | 700 | 150 | — |
| `enemy-rat-ambient` | 450 | 80 | [3000, 8000] |

All values are starting points — adjust by ear after smoke testing.
