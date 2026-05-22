# Enemy Ambient Proximity Audio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make vulture ambient loop fade with distance and make rat ambient fire intermittently at proximity-scaled volume.

**Architecture:** A 100ms-throttled block in `EnemyManager.update()` computes distance from player to nearest enemy of each type, converts it to a 0–1 proximity factor, and drives `AudioManager.setLoopProximity()` (vulture loop) and `AudioManager.playProximate()` (rat one-shot). A new pure function `distanceToProximityT` handles the math and is unit-tested.

**Tech Stack:** TypeScript, Phaser 3, Vitest

---

## File Map

| File | Change |
|------|--------|
| `src/data/soundDefs.ts` | Add 3 optional fields to `SoundDef`; update vulture + rat entries |
| `src/systems/AudioManager.ts` | Export `distanceToProximityT`; add `setLoopProximity` and `playProximate` methods |
| `src/systems/__tests__/AudioManager.test.ts` | Tests for `distanceToProximityT` |
| `src/systems/EnemyManager.ts` | Add `playerX/Y` params to `update()`; throttled proximity block; remove old play/stop calls |
| `src/scenes/GameScene.ts` | Pass player position to `enemyManager.update()` |
| `src/scenes/InfiniteGameScene.ts` | Pass player position to `em.update()` in the loop |

---

### Task 1: `distanceToProximityT` pure function + tests

**Files:**
- Modify: `src/systems/AudioManager.ts`
- Modify: `src/systems/__tests__/AudioManager.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the bottom of `src/systems/__tests__/AudioManager.test.ts`:

```typescript
import { effectiveVolume, proximityVolume, proximityRate, distanceToProximityT } from '../AudioManager';

describe('distanceToProximityT', () => {
  it('returns 1 when dist is within full-volume zone', () => {
    expect(distanceToProximityT(50, 100, 500)).toBe(1);
  });

  it('returns 1 when dist equals fullVolumeDistancePx', () => {
    expect(distanceToProximityT(100, 100, 500)).toBe(1);
  });

  it('returns 0 when dist equals maxAudibleDistancePx', () => {
    expect(distanceToProximityT(500, 100, 500)).toBe(0);
  });

  it('returns 0 when dist exceeds maxAudibleDistancePx', () => {
    expect(distanceToProximityT(999, 100, 500)).toBe(0);
  });

  it('returns 0.5 at the midpoint between fullVolume and maxAudible', () => {
    // midpoint of [100, 500] is 300
    expect(distanceToProximityT(300, 100, 500)).toBeCloseTo(0.5);
  });

  it('returns 1 when fullVolumeDistancePx equals maxAudibleDistancePx (no falloff zone)', () => {
    expect(distanceToProximityT(100, 200, 200)).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /home/connor/Documents/Repos/HeapGame && npm test -- --reporter=verbose 2>&1 | grep -A 3 "distanceToProximityT"
```

Expected: FAIL — `distanceToProximityT is not a function` or import error.

- [ ] **Step 3: Add the export to AudioManager.ts**

In `src/systems/AudioManager.ts`, add after the `proximityRate` export (around line 16):

```typescript
export function distanceToProximityT(
  dist: number,
  fullVolumeDistancePx: number,
  maxAudibleDistancePx: number,
): number {
  if (dist <= fullVolumeDistancePx) return 1;
  if (maxAudibleDistancePx <= fullVolumeDistancePx) return 1;
  if (dist >= maxAudibleDistancePx) return 0;
  return 1 - (dist - fullVolumeDistancePx) / (maxAudibleDistancePx - fullVolumeDistancePx);
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /home/connor/Documents/Repos/HeapGame && npm test -- --reporter=verbose 2>&1 | grep -A 3 "distanceToProximityT"
```

Expected: all 6 `distanceToProximityT` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/systems/AudioManager.ts src/systems/__tests__/AudioManager.test.ts
git commit -m "feat: export distanceToProximityT pure function with tests"
```

---

### Task 2: Extend SoundDef type and update SOUND_DEFS entries

**Files:**
- Modify: `src/data/soundDefs.ts`

- [ ] **Step 1: Add optional fields to the `SoundDef` interface**

In `src/data/soundDefs.ts`, update the interface to:

```typescript
export interface SoundDef {
  category:              SoundCategory;
  baseVolume:            number;
  loop:                  boolean;
  url:                   string;
  maxAudibleDistancePx?: number;   // beyond this → silent
  fullVolumeDistancePx?: number;   // closer than this → full baseVolume
  playIntervalMs?:       [number, number]; // [min, max] ms, for intermittent one-shots
}
```

- [ ] **Step 2: Update `enemy-vulture-ambient` entry**

Change:
```typescript
'enemy-vulture-ambient': { category: 'enemySfx',  loop: true,  baseVolume: 0.4, url: enemyVultureUrl },
```
To:
```typescript
'enemy-vulture-ambient': { category: 'enemySfx', loop: true,  baseVolume: 0.4, url: enemyVultureUrl, maxAudibleDistancePx: 700, fullVolumeDistancePx: 150 },
```

- [ ] **Step 3: Update `enemy-rat-ambient` entry**

Change:
```typescript
'enemy-rat-ambient':     { category: 'enemySfx',  loop: true,  baseVolume: 0.4, url: enemyRatUrl },
```
To:
```typescript
'enemy-rat-ambient':     { category: 'enemySfx', loop: false, baseVolume: 0.4, url: enemyRatUrl, maxAudibleDistancePx: 450, fullVolumeDistancePx: 80, playIntervalMs: [3000, 8000] },
```

- [ ] **Step 4: Build check**

```bash
cd /home/connor/Documents/Repos/HeapGame && npm run build 2>&1 | tail -10
```

Expected: no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/data/soundDefs.ts
git commit -m "feat: add proximity + interval fields to SoundDef; update vulture and rat entries"
```

---

### Task 3: Add `setLoopProximity` and `playProximate` to AudioManager

**Files:**
- Modify: `src/systems/AudioManager.ts`

These methods are Phaser-dependent (they call `this.sm`) and can't be unit tested in isolation. The pure math they rely on (`proximityVolume`, `distanceToProximityT`) is already covered by tests.

- [ ] **Step 1: Add `setLoopProximity` method to `_AudioManager`**

Add after `setWallProximity` (around line 129), before `getVolumes`:

```typescript
setLoopProximity(key: string, t: number): void {
  if (!this.sm) return;
  const def = SOUND_DEFS[key];
  if (!def) return;

  if (t <= 0.01) {
    this.stop(key);
    return;
  }

  const vol = proximityVolume(t, def.baseVolume, this.volumes[def.category], this.volumes.master);

  if (!this.playing.has(key)) {
    if (!this.sm.game?.cache?.audio?.has(key)) return;
    const sound = this.sm.add(key, { loop: true, volume: vol });
    sound.play();
    this.playing.set(key, sound);
  } else {
    this.playing.get(key)!.setVolume(vol);
  }
}

playProximate(key: string, t: number): void {
  if (t <= 0.01) return;
  const def = SOUND_DEFS[key];
  if (!def) return;
  // Pass t-scaled base to play(); play() applies category + master on top,
  // giving: Math.pow(t, 0.7) * base * category * master = proximityVolume result.
  const tScaledBase = Math.pow(t, 0.7) * def.baseVolume;
  this.play(key, { volume: tScaledBase });
}
```

- [ ] **Step 2: Build check**

```bash
cd /home/connor/Documents/Repos/HeapGame && npm run build 2>&1 | tail -10
```

Expected: no TypeScript errors.

- [ ] **Step 3: Run full test suite**

```bash
cd /home/connor/Documents/Repos/HeapGame && npm test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/systems/AudioManager.ts
git commit -m "feat: add setLoopProximity and playProximate to AudioManager"
```

---

### Task 4: Update EnemyManager — proximity accumulator, rat timer, remove old calls

**Files:**
- Modify: `src/systems/EnemyManager.ts`

- [ ] **Step 1: Add new private fields**

In `src/systems/EnemyManager.ts`, inside the `EnemyManager` class, add two new private fields after `private readonly runtime`:

```typescript
private proximityNextAt = 0;
private ratChirpAt      = 0;
```

- [ ] **Step 2: Update `update()` signature to accept player position**

Change:
```typescript
update(_camTop: number, camBottom: number): void {
```
To:
```typescript
update(_camTop: number, camBottom: number, playerX: number, playerY: number): void {
```

- [ ] **Step 3: Add the throttled proximity block at the top of `update()`**

Add after `const cullY = camBottom + ENEMY_CULL_DISTANCE;` and before the `for` loop. The existing `const children` declared just above is already in scope — do not re-declare it inside the block:

```typescript
// ── Proximity audio (100 ms throttle) ─────────────────────────────────────
if (now >= this.proximityNextAt) {
  this.proximityNextAt = now + 100;

  // Vulture ambient — continuous loop driven by nearest ghost distance
  const vultureDef = SOUND_DEFS['enemy-vulture-ambient'];
  if (vultureDef?.maxAudibleDistancePx !== undefined) {
    let minDist = Infinity;
    for (const s of children) {
      const rt = this.runtime.get(s);
      if (rt?.kind !== 'ghost') continue;
      const dx = s.x - playerX;
      const dy = s.y - playerY;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < minDist) minDist = d;
    }
    const t = minDist === Infinity ? 0 : distanceToProximityT(
      minDist,
      vultureDef.fullVolumeDistancePx ?? 0,
      vultureDef.maxAudibleDistancePx,
    );
    AudioManager.setLoopProximity('enemy-vulture-ambient', t);
  }

  // Rat chirp — intermittent one-shot at nearest rat distance
  const ratDef = SOUND_DEFS['enemy-rat-ambient'];
  if (ratDef?.maxAudibleDistancePx !== undefined && this.ratCount() > 0 && now >= this.ratChirpAt) {
    let minDist = Infinity;
    for (const s of children) {
      const rt = this.runtime.get(s);
      if (rt?.kind !== 'percher') continue;
      const dx = s.x - playerX;
      const dy = s.y - playerY;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < minDist) minDist = d;
    }
    if (minDist < Infinity) {
      const t = distanceToProximityT(
        minDist,
        ratDef.fullVolumeDistancePx ?? 0,
        ratDef.maxAudibleDistancePx,
      );
      AudioManager.playProximate('enemy-rat-ambient', t);
    }
    const [minMs, maxMs] = ratDef.playIntervalMs ?? [3000, 8000];
    this.ratChirpAt = now + Phaser.Math.Between(minMs, maxMs);
  }
}
```

- [ ] **Step 4: Add the `SOUND_DEFS` and `distanceToProximityT` imports**

At the top of `src/systems/EnemyManager.ts`, add to the existing AudioManager import line and add a new import:

```typescript
import { AudioManager, distanceToProximityT } from './AudioManager';
import { SOUND_DEFS } from '../data/soundDefs';
```

(The file already imports `AudioManager` — extend that import, and add `SOUND_DEFS` if not already present.)

- [ ] **Step 5: Remove the old play/stop calls from `trySpawn`**

In `trySpawn`, find and delete these four lines:

```typescript
if (def.kind === 'ghost' && this.ghostCount() === 1) {
  AudioManager.play('enemy-vulture-ambient');
}
if (def.kind === 'percher' && this.ratCount() === 1) {
  AudioManager.play('enemy-rat-ambient');
}
```

- [ ] **Step 6: Remove the old play/stop calls from the destroy callback**

In `trySpawn`, inside `enemy.sprite.once(Phaser.GameObjects.Events.DESTROY, ...)`, find and delete:

```typescript
if (rt.kind === 'ghost' && this.ghostCount() === 0) {
  AudioManager.stop('enemy-vulture-ambient');
}
if (rt.kind === 'percher' && this.ratCount() === 0) {
  AudioManager.stop('enemy-rat-ambient');
}
```

- [ ] **Step 7: Build check**

```bash
cd /home/connor/Documents/Repos/HeapGame && npm run build 2>&1 | tail -15
```

Expected: no TypeScript errors.

- [ ] **Step 8: Run full test suite**

```bash
cd /home/connor/Documents/Repos/HeapGame && npm test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/systems/EnemyManager.ts
git commit -m "feat: proximity audio in EnemyManager — vulture loop falloff + rat intermittent chirp"
```

---

### Task 5: Update callers — GameScene and InfiniteGameScene

**Files:**
- Modify: `src/scenes/GameScene.ts:350`
- Modify: `src/scenes/InfiniteGameScene.ts` (inside `for (const em of this.enemyManagers)` loop)

- [ ] **Step 1: Update GameScene**

In `src/scenes/GameScene.ts`, find:
```typescript
this.enemyManager.update(camTop, camBottom);
```
Replace with:
```typescript
this.enemyManager.update(camTop, camBottom, this.player.sprite.x, this.player.sprite.y);
```

- [ ] **Step 2: Update InfiniteGameScene**

In `src/scenes/InfiniteGameScene.ts`, find:
```typescript
em.update(camTop, camBot);
```
Replace with:
```typescript
em.update(camTop, camBot, this.player.sprite.x, this.player.sprite.y);
```

- [ ] **Step 3: Build check**

```bash
cd /home/connor/Documents/Repos/HeapGame && npm run build 2>&1 | tail -10
```

Expected: no TypeScript errors.

- [ ] **Step 4: Run full test suite**

```bash
cd /home/connor/Documents/Repos/HeapGame && npm test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/scenes/GameScene.ts src/scenes/InfiniteGameScene.ts
git commit -m "feat: pass player position to EnemyManager.update() in both game scenes"
```

---

## Smoke Test Checklist

After all tasks are complete, test in the browser (LAN URL if no local speakers):

- [ ] Vulture spawns → ambient loop starts quietly, gets louder as you approach, fades as you move away, stops when last vulture dies
- [ ] No vultures present → vulture ambient is silent
- [ ] Rats present → occasional chirp sounds every few seconds (not a constant drone)
- [ ] Stand far from all rats → chirps are quieter or silent
- [ ] Stand next to a rat → chirps are noticeably louder
- [ ] No rats present → no rat sounds at all
- [ ] Wall rumble, music, player SFX unaffected
- [ ] Volume sliders in settings still work for all categories
