# Player Outro Animation — Design Spec

**Date:** 2026-05-24
**Branch:** `feature/player-outro-animation`
**Status:** Design — awaiting implementation plan

---

## 1. Concept & Scope

A single shared **PlayerOutro** subsystem handles two transitions: **death** (fatal hit → score scene) and **success** (placement complete → score scene). Both lift the player off the world, run a 2.5s cinematic on an overlay layer, and hand off to ScoreScene.

- **Death** = downward / cool / inward (drift to screen center, fade to black, white gradient, white starburst).
- **Success** = upward / warm / outward (drift to screen top, dim to gold tint, gold gradient, gold starburst).

Same code paths, inverted parameters. Single system, two configurations.

### Out of Scope (Explicitly Cut)

These were considered during brainstorming and rejected to keep the system focused:

- Trash-fountain particle explosion (from the original ideas doc)
- "Ghost Bag" rising soul
- Red collar / tie-ear parachute
- Dizzy stars halo
- Global slow-motion time-scale
- Confetti / sparkle trails
- Spotlight + bow alternative
- Camera reframe (vs. overlay-layer approach)

---

## 2. Architecture

### New Class: `PlayerOutro`

Lives at `src/entities/PlayerOutro.ts` alongside `PlayerAnimator`. Self-contained state machine that owns the entire outro sequence.

**Public API:**
```ts
class PlayerOutro {
  constructor(scene: Phaser.Scene, sourceSprite: SpriteWithDynamicBody);
  play(kind: 'death' | 'success', onComplete: () => void): void;
  destroy(): void;
}
```

### Hook Points in Existing Code

- **`src/entities/PlayerAnimator.ts:96-103`** — current `justDied` branch flattens the sprite and goes dormant. Replace this with a call up to GameScene to trigger `outro.play('death', ...)`. PlayerAnimator remains dormant for the outro duration.
- **`PlayerAnimState`** (in `src/entities/Player.ts`) — add a new `justPlaced` flag, fed in the same way `justDied` is, to trigger the success outro.
- **GameScene** owns the `PlayerOutro` instance and decides when to invoke it (in response to player state flags). It also wires the `onComplete` callback to start ScoreScene.

### Overlay Layer Mechanic ("Lift Out")

1. On trigger, capture player's current world position; convert to screen coords via the active camera.
2. Hide the in-world player sprite (`setVisible(false)`). Body stays for collision-clear but is invisible.
3. Spawn a **proxy sprite** (clone of the player visual) on a top-depth container with `setScrollFactor(0)` — i.e. screen-space, not world-space. This is the "overlay layer."
   - The bow strings from `PlayerAnimator` are not transferred. They render on a separate `Graphics` object synced via `POST_UPDATE` to the in-world sprite, which is now hidden. Strings simply disappear at outro start. Re-drawing them on the proxy in screen-space is deferred as future polish (see §7).
4. All animation (drift, squish, shrink, twinkle, gradient, fade) happens on this overlay. World below continues to render but is fully paused (see §3).
5. On completion, fire the `onComplete` callback that GameScene uses to start ScoreScene.

**Why a proxy sprite rather than re-parenting the real one:** Phaser does not cleanly support re-parenting between world and UI camera spaces, and the player's physics body is awkward to detach mid-frame. A short-lived proxy is cheaper to implement and isolates the outro from gameplay state.

### Gradient & Fade Rendering

- A single `Phaser.GameObjects.Graphics` on the overlay layer, redrawn each frame.
- Draws a radial gradient (bright core fading outward) centered on the proxy's current screen position.
- Fade/dim is layered on top as a second graphics fill with rising alpha.

| | Death | Success |
|---|---|---|
| Background fill | Black, alpha 0 → 1.0 | Gold (`#ffaa33`), alpha 0 → 0.6 |
| Radial gradient core | White (`#ffffff`) | Gold (`#ffd060`) |

---

## 3. World Pause, Input Lock, Skip

### At Trigger

1. `scene.physics.world.pause()` — freezes all Arcade bodies (enemies, player, projectiles, falling debris).
2. Player input disabled (existing `frozen` flag in `PlayerAnimState` already gates input).
3. PlayerAnimator goes dormant (already does on `justDied`; same path for `justPlaced`).
4. `PlayerOutro` takes over rendering and timing via its own `scene.events.on(UPDATE)` loop — independent of physics.

### At Completion

- Outro fires `onComplete`. GameScene starts ScoreScene; GameScene is stopped.
- No need to resume physics — GameScene is being torn down.

### Tap-to-Skip

- Available the entire 2.5s window, from t=0.
- Tap zone is the full screen (a transparent input rectangle on the overlay layer).
- Behavior: **hard cut** — immediately teardown proxy + overlay graphics + fire `onComplete`. No final flourish, no fast-forward animation.

### Interrupt Resilience

- Outro is uninterruptible by gameplay events once started (it's only 2.5s, ScoreScene is in-flight).
- Audio-focus-pause (existing feature) pauses the outro's tweens and resumes them — same as any other animation; no special handling.

---

## 4. Sequence Timing

Both outros share a 4-beat structure. Easing and palette differ per kind.

### Timeline (2.5s total)

| Beat | Window | Death | Success |
|---|---|---|---|
| **Drift** | 0.0 – 1.8s | Proxy tweens from death position to **screen center**. Background fades black (alpha 0→1). White radial gradient grows on proxy. | Proxy tweens from placement position to **screen top-center** (y = 15% of screen height). Background dims with gold tint (alpha 0→0.6). Gold radial gradient grows on proxy. |
| **Squish** | 1.8 – 2.0s | Quick squash: scaleY → 0.4, scaleX → 1.6 over 80ms, then settle to neutral over 120ms. | Joyful squash-bounce: scaleY → 1.3, scaleX → 0.85 (stretch up) for 100ms, then settle for 100ms. |
| **Shrink + Pop** | 2.0 – 2.4s | Proxy uniformly scales 1.0 → 0.0 over 400ms with `Cubic.easeIn`. Gradient stays bright. | Same shape, same easing. |
| **Twinkle** | 2.4 – 2.5s | Single 4-point starburst at the pop point, pure white (`#ffffff`). Scales 0→1.4 over 40ms (`Back.easeOut`), holds 30ms, fades over 30ms. | Same starburst shape, gold (`#ffd060`). |
| **Hand-off** | 2.5s | `onComplete` fires; GameScene starts ScoreScene. |

### Easing Summary

- **Drift:** `Cubic.easeOut` — decisive start, soft landing at destination.
- **Squish:** linear with explicit time slicing (snap squash + ease settle).
- **Shrink:** `Cubic.easeIn` — gentle start, sharp finish; matches the "pop."
- **Starburst:** `Back.easeOut` for scale-up — crisp snap.

---

## 5. File Layout & Data Flow

### New Files

- `src/entities/PlayerOutro.ts` — the outro state machine described in §2.

### Modified Files

- `src/entities/Player.ts` — add `justPlaced` flag to `PlayerAnimState`.
- `src/entities/PlayerAnimator.ts:96-103` — remove the inline death cleanup; instead, signal up to GameScene which delegates to `PlayerOutro`. PlayerAnimator still goes dormant on either flag.
- `src/scenes/GameScene.ts` — instantiate `PlayerOutro`, wire `onComplete` to start ScoreScene, and call `outro.play(...)` on `justDied` or `justPlaced`.
- `src/scenes/InfiniteGameScene.ts` — same wiring as GameScene. Both scenes own a player and transition to ScoreScene, so both need outro integration.

### Data Flow

```
Player state (justDied | justPlaced)
        ↓
GameScene observes flag
        ↓
GameScene.startOutro(kind)
   ├─ physics.world.pause()
   ├─ player.setFrozen(true)
   ├─ animator goes dormant
   └─ outro.play(kind, onComplete=startScoreScene)
            ↓
       PlayerOutro
         ├─ snapshot world→screen position
         ├─ hide real sprite
         ├─ spawn proxy on overlay (scrollFactor=0)
         ├─ register full-screen tap listener (hard-cut)
         ├─ run 4-beat sequence (drift → squish → shrink → twinkle)
         └─ onComplete()
                  ↓
             GameScene.scene.start('ScoreScene', {...})
```

---

## 6. Testing Strategy

Per project convention (CLAUDE.md): TDD before implementation, then `npm run build` + `npm test` before claiming done.

### Unit Tests (Vitest)

- `PlayerOutro` state machine: `play('death')` and `play('success')` each advance through all 4 beats in order under simulated time deltas.
- Tap-to-skip: invoking the skip handler at any t between 0 and 2.5s fires `onComplete` exactly once and tears down resources.
- `onComplete` is idempotent — skip + natural completion don't both fire it.
- `destroy()` cleans up overlay graphics, proxy sprite, event listeners (no leaks).

### Visual Verification

Use the `heap-scene-preview` skill (per CLAUDE.md) to capture both outros at pixel7 dimensions. Add a `?dev=GameScene&params={outro:'death'}` shortcut (or similar) to BootScene that auto-triggers the outro from a known state.

### Build / Type Check

- `npm run build` must pass (catches TS errors tests miss).
- `npm test` must pass.

---

## 7. Open Questions / Future Work

None blocking. Possible future extensions explicitly deferred:

- Audio cue on each outro (a short SFX would land well on the squish and on the starburst). Coordinate with the existing AudioManager when wired in.
- Variations per heap or per placeable type (different palette per heap?).
- Reduced-motion accessibility setting that shortens the outro or skips to twinkle directly.
- Bow strings rendered on the proxy sprite in screen-space (currently they disappear at outro start since the in-world sprite is hidden).
