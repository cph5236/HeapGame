# Player Outro Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a unified `PlayerOutro` system that runs a 2.5s cinematic transition for both player death and successful placement, then hands off to ScoreScene.

**Architecture:** A self-contained `PlayerOutro` class spawns a screen-space proxy sprite on an overlay layer, runs a 4-beat tween sequence (drift → squish → shrink → twinkle) parameterized by kind (`death` vs `success`), and fires a callback on completion. Death and success share all code; only direction (center vs top), palette (white/black vs gold), and squish shape differ. Tap-anywhere hard-cuts to the callback.

**Tech Stack:** Phaser 3.90 (tweens, graphics, scene events), TypeScript 5.9, Vitest for unit tests.

**Spec:** [docs/superpowers/specs/2026-05-24-player-outro-animation-design.md](../specs/2026-05-24-player-outro-animation-design.md)

---

## File Map

**Create:**
- `src/entities/PlayerOutro.ts` — the outro state machine (~250 lines)
- `src/entities/__tests__/PlayerOutro.test.ts` — unit tests with stub scene

**Modify:**
- `src/entities/Player.ts:47-57,135-147` — add `justPlaced` field to `PlayerAnimState`
- `src/entities/PlayerAnimator.ts:96-107` — extend `justDied` branch to also catch `justPlaced` (animator goes dormant for either outro)
- `src/scenes/GameScene.ts:184-227, 494-547, 612-662` — instantiate PlayerOutro, wire all three transition sites
- `src/scenes/InfiniteGameScene.ts:412, 434` — wire death transition through PlayerOutro
- `src/scenes/BootScene.ts` — add `?dev=outro&kind=death|success` shortcut for visual preview

---

## Task 1: Add `justPlaced` Flag to PlayerAnimState

**Files:**
- Modify: `src/entities/Player.ts:47-57, 135-147`
- Test: `src/entities/__tests__/Player.test.ts`

- [ ] **Step 1: Add the field to the interface**

In `src/entities/Player.ts` at line 47-57, change the interface:

```typescript
export interface PlayerAnimState {
  vy:             number;
  onGround:       boolean;
  onWall:         boolean;
  frozen:         boolean;
  justLanded:     boolean;
  justJumped:     boolean;
  justAirJumped:  boolean;
  justWallJumped: boolean;
  justDied:       boolean;
  justPlaced:     boolean;
}
```

- [ ] **Step 2: Default the field in the animState getter**

In `src/entities/Player.ts` at line 135-147, add `justPlaced: false` to the returned object:

```typescript
get animState(): PlayerAnimState {
  return {
    vy:             this.sprite.body.velocity.y,
    onGround:       this._onGround,
    onWall:         this._onWall,
    frozen:         this._frozen,
    justLanded:     this._justLanded,
    justJumped:     this._justJumped,
    justAirJumped:  this._justAirJumped,
    justWallJumped: this._justWallJumped,
    justDied:       false,
    justPlaced:     false,
  };
}
```

- [ ] **Step 3: Run typecheck to confirm no consumers broke**

Run: `npx tsc --noEmit`

Expected: PASS. The animator's `justDied` branch will still typecheck; the new field flows as an optional-feeling addition since callers spread/override it.

- [ ] **Step 4: Run tests**

Run: `npm test`

Expected: PASS. No existing test references `justPlaced`.

- [ ] **Step 5: Commit**

```bash
git add src/entities/Player.ts
git commit -m "feat(player): add justPlaced flag to PlayerAnimState"
```

---

## Task 2: Extend PlayerAnimator to Handle `justPlaced` Same as `justDied`

**Files:**
- Modify: `src/entities/PlayerAnimator.ts:96-107`

- [ ] **Step 1: Extend the dormancy branch**

In `src/entities/PlayerAnimator.ts`, at the block currently around line 96-107:

```typescript
// ── Interrupts (checked before anything else) ──────────────────────────
if (state.justDied || state.justPlaced) {
  this.sprite.setScale(this.baseScaleX, this.baseScaleY);
  this.sprite.setAngle(0);
  this.sprite.body.setSize(PLAYER_WIDTH / this.baseScaleX, PLAYER_HEIGHT / this.baseScaleY);
  this.gfx.clear();
  this.dormant = true;
  return;
}
if (state.frozen) {
  this.dormant = true;
  return;
}
```

This preserves the existing "reset to neutral pose and stop drawing" behavior — PlayerOutro relies on the animator being dormant during the outro so it doesn't fight the proxy sprite.

- [ ] **Step 2: Run typecheck + tests**

Run: `npx tsc --noEmit && npm test`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/entities/PlayerAnimator.ts
git commit -m "feat(animator): go dormant on justPlaced same as justDied"
```

---

## Task 3: Scaffold PlayerOutro With Contract Tests

This task creates the file with stub implementation and the foundational tests for the public API contract. Each subsequent task fills in behavior.

**Files:**
- Create: `src/entities/PlayerOutro.ts`
- Create: `src/entities/__tests__/PlayerOutro.test.ts`

- [ ] **Step 1: Write the failing contract tests**

Create `src/entities/__tests__/PlayerOutro.test.ts`:

```typescript
/**
 * PlayerOutro.test.ts — unit tests for the public API contract.
 *
 * Strategy: PlayerOutro uses type-only imports for Phaser, so we hand-roll a
 * stub `scene` object that records calls without requiring a Phaser module mock.
 * Each test captures the tween/timer callbacks that PlayerOutro registers and
 * fires them manually to drive the state machine forward.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlayerOutro } from '../PlayerOutro';

// ── Stub scene ────────────────────────────────────────────────────────────────

interface CapturedTimer { ms: number; callback: () => void; remove: () => void; removed: boolean }

function makeStubScene() {
  const timers: CapturedTimer[] = [];
  const tweens: Array<{ stop: () => void; config: Record<string, unknown> }> = [];
  const eventHandlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  const inputHandlers: Record<string, Array<(...args: unknown[]) => void>> = {};

  const stubGraphics = {
    setDepth:       vi.fn().mockReturnThis(),
    setScrollFactor: vi.fn().mockReturnThis(),
    clear:          vi.fn().mockReturnThis(),
    fillStyle:      vi.fn().mockReturnThis(),
    fillRect:       vi.fn().mockReturnThis(),
    fillCircle:     vi.fn().mockReturnThis(),
    fillTriangle:   vi.fn().mockReturnThis(),
    lineStyle:      vi.fn().mockReturnThis(),
    strokePath:     vi.fn().mockReturnThis(),
    beginPath:      vi.fn().mockReturnThis(),
    moveTo:         vi.fn().mockReturnThis(),
    lineTo:         vi.fn().mockReturnThis(),
    setPosition:    vi.fn().mockReturnThis(),
    setAlpha:       vi.fn().mockReturnThis(),
    setVisible:     vi.fn().mockReturnThis(),
    destroy:        vi.fn(),
  };

  const stubSprite = {
    setDepth:       vi.fn().mockReturnThis(),
    setScrollFactor: vi.fn().mockReturnThis(),
    setScale:       vi.fn().mockReturnThis(),
    setPosition:    vi.fn().mockReturnThis(),
    setVisible:     vi.fn().mockReturnThis(),
    setDisplaySize: vi.fn().mockReturnThis(),
    destroy:        vi.fn(),
    x: 0, y: 0,
  };

  const scene = {
    add: {
      graphics: vi.fn(() => ({ ...stubGraphics })),
      sprite:   vi.fn(() => ({ ...stubSprite })),
    },
    time: {
      delayedCall: vi.fn((ms: number, callback: () => void) => {
        const t: CapturedTimer = { ms, callback, removed: false, remove: () => { t.removed = true; } };
        timers.push(t);
        return t;
      }),
    },
    tweens: {
      add: vi.fn((cfg: Record<string, unknown>) => {
        const t = { stop: vi.fn(), config: cfg };
        tweens.push(t);
        return t;
      }),
    },
    events: {
      on:  vi.fn((event: string, fn: (...args: unknown[]) => void) => {
        (eventHandlers[event] ??= []).push(fn);
      }),
      off: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
        const arr = eventHandlers[event];
        if (arr) eventHandlers[event] = arr.filter(h => h !== fn);
      }),
    },
    input: {
      on:  vi.fn((event: string, fn: (...args: unknown[]) => void) => {
        (inputHandlers[event] ??= []).push(fn);
      }),
      off: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
        const arr = inputHandlers[event];
        if (arr) inputHandlers[event] = arr.filter(h => h !== fn);
      }),
    },
    physics: {
      world: { pause: vi.fn(), resume: vi.fn() },
    },
    cameras: {
      main: { scrollX: 0, scrollY: 0, worldView: { x: 0, y: 0 } },
    },
    scale: { width: 480, height: 854 },
  };

  return { scene, timers, tweens, eventHandlers, inputHandlers };
}

function makeStubSprite() {
  return {
    x: 240, y: 400,
    scaleX: 1, scaleY: 1,
    texture: { key: 'trashbag-nostrings' },
    setVisible: vi.fn().mockReturnThis(),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('PlayerOutro — public API contract', () => {
  let stub: ReturnType<typeof makeStubScene>;
  let sprite: ReturnType<typeof makeStubSprite>;
  let outro: PlayerOutro;
  let onComplete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stub = makeStubScene();
    sprite = makeStubSprite();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    outro = new PlayerOutro(stub.scene as any, sprite as any);
    onComplete = vi.fn();
  });

  it('play("death") schedules the final hand-off after ~2500ms', () => {
    outro.play('death', onComplete);
    const finalTimer = stub.timers.find(t => t.ms === 2500);
    expect(finalTimer).toBeDefined();
    expect(onComplete).not.toHaveBeenCalled();
    finalTimer!.callback();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('play("success") schedules the final hand-off after ~2500ms', () => {
    outro.play('success', onComplete);
    const finalTimer = stub.timers.find(t => t.ms === 2500);
    expect(finalTimer).toBeDefined();
    finalTimer!.callback();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('skip() fires onComplete immediately', () => {
    outro.play('death', onComplete);
    outro.skip();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('onComplete fires exactly once even when skip races natural completion', () => {
    outro.play('death', onComplete);
    outro.skip();
    const finalTimer = stub.timers.find(t => t.ms === 2500);
    finalTimer!.callback();  // natural completion runs after skip
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('destroy() removes all registered event listeners', () => {
    outro.play('death', onComplete);
    outro.destroy();
    expect(stub.scene.events.off).toHaveBeenCalled();
    expect(stub.scene.input.off).toHaveBeenCalled();
  });

  it('play() throws if called twice without destroy or completion', () => {
    outro.play('death', onComplete);
    expect(() => outro.play('death', onComplete)).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails (file doesn't exist)**

Run: `npx vitest run src/entities/__tests__/PlayerOutro.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Create the PlayerOutro stub**

Create `src/entities/PlayerOutro.ts`:

```typescript
import type Phaser from 'phaser';

export type OutroKind = 'death' | 'success';

const TOTAL_DURATION_MS = 2500;

/**
 * Cinematic transition that lifts the player off the world onto a screen-space
 * overlay, runs a 4-beat sequence (drift → squish → shrink → twinkle), and
 * fires onComplete. Tap anywhere hard-cuts to onComplete.
 */
export class PlayerOutro {
  private readonly scene: Phaser.Scene;
  private readonly sourceSprite: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;

  private playing = false;
  private completed = false;
  private onComplete: (() => void) | null = null;

  private finalTimer: Phaser.Time.TimerEvent | null = null;
  private activeTweens: Array<{ stop: () => void }> = [];
  private tapHandler: ((...args: unknown[]) => void) | null = null;

  constructor(
    scene: Phaser.Scene,
    sourceSprite: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody,
  ) {
    this.scene = scene;
    this.sourceSprite = sourceSprite;
  }

  play(_kind: OutroKind, onComplete: () => void): void {
    if (this.playing) throw new Error('PlayerOutro: play() called while already playing');
    this.playing = true;
    this.completed = false;
    this.onComplete = onComplete;

    this.tapHandler = () => this.skip();
    this.scene.input.on('pointerdown', this.tapHandler);

    this.finalTimer = this.scene.time.delayedCall(TOTAL_DURATION_MS, () => this.finish());
  }

  skip(): void {
    if (!this.playing || this.completed) return;
    this.finish();
  }

  destroy(): void {
    if (this.finalTimer) this.finalTimer.remove();
    this.activeTweens.forEach(t => t.stop());
    this.activeTweens = [];
    if (this.tapHandler) this.scene.input.off('pointerdown', this.tapHandler);
    this.tapHandler = null;
    this.scene.events.off('shutdown');  // no-op safety
  }

  private finish(): void {
    if (this.completed) return;
    this.completed = true;
    this.playing = false;

    const cb = this.onComplete;
    this.onComplete = null;
    this.destroy();
    cb?.();
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/entities/__tests__/PlayerOutro.test.ts`

Expected: PASS — all 6 tests green.

- [ ] **Step 5: Run full build + test**

Run: `npm run build && npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/entities/PlayerOutro.ts src/entities/__tests__/PlayerOutro.test.ts
git commit -m "feat(outro): scaffold PlayerOutro with API contract tests"
```

---

## Task 4: Implement Overlay Setup (Proxy Sprite + World-to-Screen)

**Files:**
- Modify: `src/entities/PlayerOutro.ts`
- Modify: `src/entities/__tests__/PlayerOutro.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/entities/__tests__/PlayerOutro.test.ts`:

```typescript
describe('PlayerOutro — overlay setup', () => {
  let stub: ReturnType<typeof makeStubScene>;
  let sprite: ReturnType<typeof makeStubSprite>;
  let outro: PlayerOutro;

  beforeEach(() => {
    stub = makeStubScene();
    sprite = makeStubSprite();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    outro = new PlayerOutro(stub.scene as any, sprite as any);
  });

  it('play() hides the source sprite', () => {
    outro.play('death', vi.fn());
    expect(sprite.setVisible).toHaveBeenCalledWith(false);
  });

  it('play() spawns a proxy sprite using the source texture key', () => {
    outro.play('death', vi.fn());
    expect(stub.scene.add.sprite).toHaveBeenCalledWith(
      expect.any(Number), expect.any(Number), 'trashbag-nostrings',
    );
  });

  it('play() converts source world position to screen coords via camera scroll', () => {
    stub.scene.cameras.main.scrollX = 100;
    stub.scene.cameras.main.scrollY = 200;
    sprite.x = 240; sprite.y = 400;
    outro.play('death', vi.fn());
    // Screen pos = world pos - scroll
    expect(stub.scene.add.sprite).toHaveBeenCalledWith(140, 200, 'trashbag-nostrings');
  });

  it('play() pauses physics world', () => {
    outro.play('death', vi.fn());
    expect(stub.scene.physics.world.pause).toHaveBeenCalled();
  });

  it('finish() destroys the proxy sprite', () => {
    outro.play('death', vi.fn());
    const proxySpriteCall = stub.scene.add.sprite.mock.results[0];
    outro.skip();
    expect(proxySpriteCall.value.destroy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run src/entities/__tests__/PlayerOutro.test.ts`

Expected: FAIL — overlay-setup tests fail because the stub doesn't do this yet.

- [ ] **Step 3: Implement the overlay setup**

Update `src/entities/PlayerOutro.ts` — add fields and extend `play()`/`destroy()`:

```typescript
import type Phaser from 'phaser';

export type OutroKind = 'death' | 'success';

const TOTAL_DURATION_MS = 2500;
const OVERLAY_DEPTH = 1000;

export class PlayerOutro {
  private readonly scene: Phaser.Scene;
  private readonly sourceSprite: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;

  private playing = false;
  private completed = false;
  private onComplete: (() => void) | null = null;

  private finalTimer: Phaser.Time.TimerEvent | null = null;
  private activeTweens: Array<{ stop: () => void }> = [];
  private tapHandler: ((...args: unknown[]) => void) | null = null;

  private proxy: Phaser.GameObjects.Sprite | null = null;

  constructor(
    scene: Phaser.Scene,
    sourceSprite: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody,
  ) {
    this.scene = scene;
    this.sourceSprite = sourceSprite;
  }

  play(_kind: OutroKind, onComplete: () => void): void {
    if (this.playing) throw new Error('PlayerOutro: play() called while already playing');
    this.playing = true;
    this.completed = false;
    this.onComplete = onComplete;

    this.scene.physics.world.pause();

    const cam = this.scene.cameras.main;
    const screenX = this.sourceSprite.x - cam.scrollX;
    const screenY = this.sourceSprite.y - cam.scrollY;

    const textureKey = (this.sourceSprite as unknown as { texture: { key: string } }).texture.key;
    this.proxy = this.scene.add.sprite(screenX, screenY, textureKey)
      .setScrollFactor(0)
      .setDepth(OVERLAY_DEPTH + 2);

    this.sourceSprite.setVisible(false);

    this.tapHandler = () => this.skip();
    this.scene.input.on('pointerdown', this.tapHandler);

    this.finalTimer = this.scene.time.delayedCall(TOTAL_DURATION_MS, () => this.finish());
  }

  skip(): void {
    if (!this.playing || this.completed) return;
    this.finish();
  }

  destroy(): void {
    if (this.finalTimer) this.finalTimer.remove();
    this.finalTimer = null;
    this.activeTweens.forEach(t => t.stop());
    this.activeTweens = [];
    if (this.tapHandler) this.scene.input.off('pointerdown', this.tapHandler);
    this.tapHandler = null;
    if (this.proxy) { this.proxy.destroy(); this.proxy = null; }
  }

  private finish(): void {
    if (this.completed) return;
    this.completed = true;
    this.playing = false;
    const cb = this.onComplete;
    this.onComplete = null;
    this.destroy();
    cb?.();
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/entities/__tests__/PlayerOutro.test.ts`

Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/entities/PlayerOutro.ts src/entities/__tests__/PlayerOutro.test.ts
git commit -m "feat(outro): spawn screen-space proxy sprite + pause physics"
```

---

## Task 5: Implement Background Fade + Radial Gradient Overlay

**Files:**
- Modify: `src/entities/PlayerOutro.ts`
- Modify: `src/entities/__tests__/PlayerOutro.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/entities/__tests__/PlayerOutro.test.ts`:

```typescript
describe('PlayerOutro — overlay graphics', () => {
  let stub: ReturnType<typeof makeStubScene>;
  let sprite: ReturnType<typeof makeStubSprite>;
  let outro: PlayerOutro;

  beforeEach(() => {
    stub = makeStubScene();
    sprite = makeStubSprite();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    outro = new PlayerOutro(stub.scene as any, sprite as any);
  });

  it('play() creates a background fade graphics and a gradient graphics', () => {
    outro.play('death', vi.fn());
    // Two graphics objects expected: background fade, radial gradient (plus the proxy)
    expect(stub.scene.add.graphics).toHaveBeenCalledTimes(2);
  });

  it('play("death") tweens fade alpha 0→1 over the drift window (1800ms)', () => {
    outro.play('death', vi.fn());
    const fadeTween = stub.tweens.find(t =>
      (t.config as { alpha?: { from?: number; to?: number } }).alpha?.to === 1
      && (t.config as { duration?: number }).duration === 1800,
    );
    expect(fadeTween).toBeDefined();
  });

  it('play("success") tweens fade alpha 0→0.6 over the drift window (1800ms)', () => {
    outro.play('success', vi.fn());
    const fadeTween = stub.tweens.find(t =>
      (t.config as { alpha?: { from?: number; to?: number } }).alpha?.to === 0.6
      && (t.config as { duration?: number }).duration === 1800,
    );
    expect(fadeTween).toBeDefined();
  });

  it('finish() destroys all graphics objects', () => {
    outro.play('death', vi.fn());
    const graphicsCalls = stub.scene.add.graphics.mock.results;
    outro.skip();
    graphicsCalls.forEach(call => {
      expect(call.value.destroy).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run src/entities/__tests__/PlayerOutro.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement fade + gradient**

Update `src/entities/PlayerOutro.ts` — add palette config, graphics fields, and per-frame redraw:

```typescript
import type Phaser from 'phaser';

export type OutroKind = 'death' | 'success';

const TOTAL_DURATION_MS = 2500;
const DRIFT_DURATION_MS = 1800;
const OVERLAY_DEPTH = 1000;

interface PaletteConfig {
  fadeColor: number;
  fadeAlphaTo: number;
  gradientColor: number;
}

const PALETTE: Record<OutroKind, PaletteConfig> = {
  death:   { fadeColor: 0x000000, fadeAlphaTo: 1.0, gradientColor: 0xffffff },
  success: { fadeColor: 0xffaa33, fadeAlphaTo: 0.6, gradientColor: 0xffd060 },
};

export class PlayerOutro {
  private readonly scene: Phaser.Scene;
  private readonly sourceSprite: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;

  private playing = false;
  private completed = false;
  private onComplete: (() => void) | null = null;
  private kind: OutroKind = 'death';

  private finalTimer: Phaser.Time.TimerEvent | null = null;
  private activeTweens: Array<{ stop: () => void }> = [];
  private tapHandler: ((...args: unknown[]) => void) | null = null;
  private updateHandler: (() => void) | null = null;

  private proxy: Phaser.GameObjects.Sprite | null = null;
  private fadeGfx: Phaser.GameObjects.Graphics | null = null;
  private gradientGfx: Phaser.GameObjects.Graphics | null = null;
  private fadeAlpha = 0;
  private gradientRadius = 0;

  constructor(
    scene: Phaser.Scene,
    sourceSprite: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody,
  ) {
    this.scene = scene;
    this.sourceSprite = sourceSprite;
  }

  play(kind: OutroKind, onComplete: () => void): void {
    if (this.playing) throw new Error('PlayerOutro: play() called while already playing');
    this.playing = true;
    this.completed = false;
    this.kind = kind;
    this.onComplete = onComplete;

    this.scene.physics.world.pause();

    const cam = this.scene.cameras.main;
    const screenX = this.sourceSprite.x - cam.scrollX;
    const screenY = this.sourceSprite.y - cam.scrollY;

    // Background fade graphics (depth: below gradient + proxy)
    this.fadeGfx = this.scene.add.graphics()
      .setScrollFactor(0)
      .setDepth(OVERLAY_DEPTH);
    this.fadeAlpha = 0;

    // Radial gradient graphics (depth: above fade, below proxy)
    this.gradientGfx = this.scene.add.graphics()
      .setScrollFactor(0)
      .setDepth(OVERLAY_DEPTH + 1);
    this.gradientRadius = 0;

    // Proxy sprite
    const textureKey = (this.sourceSprite as unknown as { texture: { key: string } }).texture.key;
    this.proxy = this.scene.add.sprite(screenX, screenY, textureKey)
      .setScrollFactor(0)
      .setDepth(OVERLAY_DEPTH + 2);

    this.sourceSprite.setVisible(false);

    this.tapHandler = () => this.skip();
    this.scene.input.on('pointerdown', this.tapHandler);

    this.updateHandler = () => this.redrawOverlay();
    this.scene.events.on('update', this.updateHandler);

    const palette = PALETTE[kind];

    // Fade tween: alpha 0 → palette.fadeAlphaTo over 1800ms
    const fadeTween = this.scene.tweens.add({
      targets: this,
      fadeAlpha: { from: 0, to: palette.fadeAlphaTo },
      duration: DRIFT_DURATION_MS,
      ease: 'Cubic.easeOut',
    });
    this.activeTweens.push(fadeTween as unknown as { stop: () => void });

    // Gradient grow tween: radius 0 → 160 over 1800ms
    const gradientTween = this.scene.tweens.add({
      targets: this,
      gradientRadius: { from: 0, to: 160 },
      duration: DRIFT_DURATION_MS,
      ease: 'Cubic.easeOut',
    });
    this.activeTweens.push(gradientTween as unknown as { stop: () => void });

    this.finalTimer = this.scene.time.delayedCall(TOTAL_DURATION_MS, () => this.finish());
  }

  skip(): void {
    if (!this.playing || this.completed) return;
    this.finish();
  }

  destroy(): void {
    if (this.finalTimer) this.finalTimer.remove();
    this.finalTimer = null;
    this.activeTweens.forEach(t => t.stop());
    this.activeTweens = [];
    if (this.tapHandler) this.scene.input.off('pointerdown', this.tapHandler);
    this.tapHandler = null;
    if (this.updateHandler) this.scene.events.off('update', this.updateHandler);
    this.updateHandler = null;
    if (this.proxy)       { this.proxy.destroy();       this.proxy = null; }
    if (this.fadeGfx)     { this.fadeGfx.destroy();     this.fadeGfx = null; }
    if (this.gradientGfx) { this.gradientGfx.destroy(); this.gradientGfx = null; }
  }

  private redrawOverlay(): void {
    if (!this.fadeGfx || !this.gradientGfx || !this.proxy) return;
    const palette = PALETTE[this.kind];
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;

    // Fade: solid rect over the whole screen, with current alpha
    this.fadeGfx.clear();
    if (this.fadeAlpha > 0) {
      this.fadeGfx.fillStyle(palette.fadeColor, this.fadeAlpha);
      this.fadeGfx.fillRect(0, 0, w, h);
    }

    // Gradient: approximate radial gradient with concentric circles at decreasing alpha
    this.gradientGfx.clear();
    if (this.gradientRadius > 0) {
      const steps = 10;
      for (let i = steps; i >= 1; i--) {
        const r = (this.gradientRadius * i) / steps;
        const alpha = (1 - (i - 1) / steps) * 0.6;
        this.gradientGfx.fillStyle(palette.gradientColor, alpha);
        this.gradientGfx.fillCircle(this.proxy.x, this.proxy.y, r);
      }
    }
  }

  private finish(): void {
    if (this.completed) return;
    this.completed = true;
    this.playing = false;
    const cb = this.onComplete;
    this.onComplete = null;
    this.destroy();
    cb?.();
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/entities/__tests__/PlayerOutro.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/entities/PlayerOutro.ts src/entities/__tests__/PlayerOutro.test.ts
git commit -m "feat(outro): add background fade + radial gradient overlay graphics"
```

---

## Task 6: Implement Drift Tween (Proxy Movement)

**Files:**
- Modify: `src/entities/PlayerOutro.ts`
- Modify: `src/entities/__tests__/PlayerOutro.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/entities/__tests__/PlayerOutro.test.ts`:

```typescript
describe('PlayerOutro — drift', () => {
  let stub: ReturnType<typeof makeStubScene>;
  let sprite: ReturnType<typeof makeStubSprite>;
  let outro: PlayerOutro;

  beforeEach(() => {
    stub = makeStubScene();
    sprite = makeStubSprite();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    outro = new PlayerOutro(stub.scene as any, sprite as any);
  });

  it('play("death") drifts proxy to screen center over 1800ms', () => {
    // Screen is 480x854; center is 240, 427
    outro.play('death', vi.fn());
    const driftTween = stub.tweens.find(t => {
      const cfg = t.config as { x?: { to?: number }; y?: { to?: number }; duration?: number };
      return cfg.duration === 1800 && cfg.x?.to === 240 && cfg.y?.to === 427;
    });
    expect(driftTween).toBeDefined();
  });

  it('play("success") drifts proxy to screen top-center (y = 15% of height) over 1800ms', () => {
    // Screen is 480x854; top-center is 240, 128 (854 * 0.15 = 128.1, floor)
    outro.play('success', vi.fn());
    const driftTween = stub.tweens.find(t => {
      const cfg = t.config as { x?: { to?: number }; y?: { to?: number }; duration?: number };
      return cfg.duration === 1800 && cfg.x?.to === 240 && Math.abs((cfg.y?.to ?? 0) - 128) <= 1;
    });
    expect(driftTween).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run src/entities/__tests__/PlayerOutro.test.ts`

Expected: FAIL.

- [ ] **Step 3: Add drift tween to play()**

In `src/entities/PlayerOutro.ts`, inside `play()` (after creating the proxy and before the fade tween), add destination computation and the drift tween:

```typescript
    // Destination: death → screen center; success → screen top-center
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;
    const destX = Math.floor(w / 2);
    const destY = kind === 'death' ? Math.floor(h / 2) : Math.floor(h * 0.15);

    const driftTween = this.scene.tweens.add({
      targets: this.proxy,
      x: { from: screenX, to: destX },
      y: { from: screenY, to: destY },
      duration: DRIFT_DURATION_MS,
      ease: 'Cubic.easeOut',
    });
    this.activeTweens.push(driftTween as unknown as { stop: () => void });
```

Place this block immediately after `this.sourceSprite.setVisible(false);` and before the input/event-handler setup. The fade and gradient tweens that follow it are unchanged.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/entities/__tests__/PlayerOutro.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/entities/PlayerOutro.ts src/entities/__tests__/PlayerOutro.test.ts
git commit -m "feat(outro): drift proxy to center (death) or top (success)"
```

---

## Task 7: Implement Squish, Shrink, and Pop Beats

**Files:**
- Modify: `src/entities/PlayerOutro.ts`
- Modify: `src/entities/__tests__/PlayerOutro.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/entities/__tests__/PlayerOutro.test.ts`:

```typescript
describe('PlayerOutro — squish + shrink', () => {
  let stub: ReturnType<typeof makeStubScene>;
  let sprite: ReturnType<typeof makeStubSprite>;
  let outro: PlayerOutro;

  beforeEach(() => {
    stub = makeStubScene();
    sprite = makeStubSprite();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    outro = new PlayerOutro(stub.scene as any, sprite as any);
  });

  it('schedules a squish beat at t=1800ms for death (wide+flat)', () => {
    outro.play('death', vi.fn());
    const squishTimer = stub.timers.find(t => t.ms === 1800);
    expect(squishTimer).toBeDefined();
  });

  it('schedules a shrink beat at t=2000ms (scale → 0 over 400ms)', () => {
    outro.play('death', vi.fn());
    const shrinkTimer = stub.timers.find(t => t.ms === 2000);
    expect(shrinkTimer).toBeDefined();
  });

  it('death squish targets scaleX=1.6, scaleY=0.4', () => {
    outro.play('death', vi.fn());
    const squishTimer = stub.timers.find(t => t.ms === 1800);
    squishTimer!.callback();
    const squishTween = stub.tweens.find(t => {
      const cfg = t.config as { scaleX?: { to?: number }; scaleY?: { to?: number } };
      return cfg.scaleX?.to === 1.6 && cfg.scaleY?.to === 0.4;
    });
    expect(squishTween).toBeDefined();
  });

  it('success squish targets scaleX=0.85, scaleY=1.3 (stretch up)', () => {
    outro.play('success', vi.fn());
    const squishTimer = stub.timers.find(t => t.ms === 1800);
    squishTimer!.callback();
    const squishTween = stub.tweens.find(t => {
      const cfg = t.config as { scaleX?: { to?: number }; scaleY?: { to?: number } };
      return cfg.scaleX?.to === 0.85 && cfg.scaleY?.to === 1.3;
    });
    expect(squishTween).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run src/entities/__tests__/PlayerOutro.test.ts`

Expected: FAIL.

- [ ] **Step 3: Add squish/shrink beats**

In `src/entities/PlayerOutro.ts`:

Add new constants at top:

```typescript
const SQUISH_T_MS = 1800;
const SHRINK_T_MS = 2000;
const SQUISH_DUR_MS = 80;
const SQUISH_SETTLE_MS = 120;
const SHRINK_DUR_MS = 400;

interface SquishConfig { scaleX: number; scaleY: number }

const SQUISH: Record<OutroKind, SquishConfig> = {
  death:   { scaleX: 1.6,  scaleY: 0.4 },
  success: { scaleX: 0.85, scaleY: 1.3 },
};
```

Extend `PaletteConfig` (no change needed — palette stays distinct from squish).

In `play()`, after the drift/fade/gradient tweens and before the final timer, add the squish and shrink timers:

```typescript
    // Squish beat at t=1800ms
    const squishTimer = this.scene.time.delayedCall(SQUISH_T_MS, () => this.runSquishBeat(kind));
    // Stash via tap-skip cleanup — squish timer is a Phaser TimerEvent; calling remove() is safe
    this.activeTweens.push({ stop: () => squishTimer.remove() });

    // Shrink beat at t=2000ms
    const shrinkTimer = this.scene.time.delayedCall(SHRINK_T_MS, () => this.runShrinkBeat());
    this.activeTweens.push({ stop: () => shrinkTimer.remove() });
```

Add the two helper methods:

```typescript
  private runSquishBeat(kind: OutroKind): void {
    if (!this.proxy || this.completed) return;
    const s = SQUISH[kind];
    const squashTween = this.scene.tweens.add({
      targets: this.proxy,
      scaleX: { from: 1, to: s.scaleX },
      scaleY: { from: 1, to: s.scaleY },
      duration: SQUISH_DUR_MS,
      ease: 'Quad.easeOut',
      onComplete: () => {
        if (!this.proxy || this.completed) return;
        const settleTween = this.scene.tweens.add({
          targets: this.proxy,
          scaleX: { from: s.scaleX, to: 1 },
          scaleY: { from: s.scaleY, to: 1 },
          duration: SQUISH_SETTLE_MS,
          ease: 'Quad.easeInOut',
        });
        this.activeTweens.push(settleTween as unknown as { stop: () => void });
      },
    });
    this.activeTweens.push(squashTween as unknown as { stop: () => void });
  }

  private runShrinkBeat(): void {
    if (!this.proxy || this.completed) return;
    const shrinkTween = this.scene.tweens.add({
      targets: this.proxy,
      scaleX: { from: 1, to: 0 },
      scaleY: { from: 1, to: 0 },
      duration: SHRINK_DUR_MS,
      ease: 'Cubic.easeIn',
    });
    this.activeTweens.push(shrinkTween as unknown as { stop: () => void });
  }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/entities/__tests__/PlayerOutro.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/entities/PlayerOutro.ts src/entities/__tests__/PlayerOutro.test.ts
git commit -m "feat(outro): squish + shrink beats with death/success variants"
```

---

## Task 8: Implement Starburst Twinkle

**Files:**
- Modify: `src/entities/PlayerOutro.ts`
- Modify: `src/entities/__tests__/PlayerOutro.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/entities/__tests__/PlayerOutro.test.ts`:

```typescript
describe('PlayerOutro — twinkle', () => {
  let stub: ReturnType<typeof makeStubScene>;
  let sprite: ReturnType<typeof makeStubSprite>;
  let outro: PlayerOutro;

  beforeEach(() => {
    stub = makeStubScene();
    sprite = makeStubSprite();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    outro = new PlayerOutro(stub.scene as any, sprite as any);
  });

  it('schedules a twinkle beat at t=2400ms', () => {
    outro.play('death', vi.fn());
    const twinkleTimer = stub.timers.find(t => t.ms === 2400);
    expect(twinkleTimer).toBeDefined();
  });

  it('twinkle spawns a third graphics object (starburst)', () => {
    outro.play('death', vi.fn());
    const twinkleTimer = stub.timers.find(t => t.ms === 2400);
    expect(stub.scene.add.graphics).toHaveBeenCalledTimes(2);  // fade + gradient
    twinkleTimer!.callback();
    expect(stub.scene.add.graphics).toHaveBeenCalledTimes(3);  // + starburst
  });

  it('twinkle starburst is destroyed by finish()', () => {
    outro.play('death', vi.fn());
    const twinkleTimer = stub.timers.find(t => t.ms === 2400);
    twinkleTimer!.callback();
    const starburstCall = stub.scene.add.graphics.mock.results[2];
    outro.skip();
    expect(starburstCall.value.destroy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run src/entities/__tests__/PlayerOutro.test.ts`

Expected: FAIL.

- [ ] **Step 3: Add the twinkle beat**

In `src/entities/PlayerOutro.ts`:

Add constants:

```typescript
const TWINKLE_T_MS = 2400;
const TWINKLE_GROW_MS = 40;
const TWINKLE_HOLD_MS = 30;
const TWINKLE_FADE_MS = 30;
const STARBURST_BASE_RADIUS = 28;
const STARBURST_MAX_SCALE = 1.4;
```

Add a field for the starburst graphics and scale:

```typescript
  private starburstGfx: Phaser.GameObjects.Graphics | null = null;
  private starburstScale = 0;
  private starburstAlpha = 1;
```

In `play()`, after the shrink timer, add:

```typescript
    const twinkleTimer = this.scene.time.delayedCall(TWINKLE_T_MS, () => this.runTwinkleBeat());
    this.activeTweens.push({ stop: () => twinkleTimer.remove() });
```

In `destroy()`, add to the cleanup block:

```typescript
    if (this.starburstGfx) { this.starburstGfx.destroy(); this.starburstGfx = null; }
```

Extend `redrawOverlay()` to also redraw the starburst each frame when present (append at the bottom of the method):

```typescript
    if (this.starburstGfx && this.proxy && this.starburstScale > 0) {
      const palette = PALETTE[this.kind];
      this.starburstGfx.clear();
      const r = STARBURST_BASE_RADIUS * this.starburstScale;
      const cx = this.proxy.x;
      const cy = this.proxy.y;
      this.starburstGfx.fillStyle(palette.gradientColor, this.starburstAlpha);
      // Four triangular points: up, right, down, left
      this.starburstGfx.fillTriangle(cx, cy - r, cx - r * 0.25, cy, cx + r * 0.25, cy);
      this.starburstGfx.fillTriangle(cx + r, cy, cx, cy - r * 0.25, cx, cy + r * 0.25);
      this.starburstGfx.fillTriangle(cx, cy + r, cx - r * 0.25, cy, cx + r * 0.25, cy);
      this.starburstGfx.fillTriangle(cx - r, cy, cx, cy - r * 0.25, cx, cy + r * 0.25);
    }
```

Add the helper:

```typescript
  private runTwinkleBeat(): void {
    if (this.completed) return;
    this.starburstGfx = this.scene.add.graphics()
      .setScrollFactor(0)
      .setDepth(OVERLAY_DEPTH + 3);
    this.starburstScale = 0;
    this.starburstAlpha = 1;

    const growTween = this.scene.tweens.add({
      targets: this,
      starburstScale: { from: 0, to: STARBURST_MAX_SCALE },
      duration: TWINKLE_GROW_MS,
      ease: 'Back.easeOut',
      onComplete: () => {
        if (this.completed) return;
        const holdTimer = this.scene.time.delayedCall(TWINKLE_HOLD_MS, () => {
          if (this.completed) return;
          const fadeTween = this.scene.tweens.add({
            targets: this,
            starburstAlpha: { from: 1, to: 0 },
            duration: TWINKLE_FADE_MS,
            ease: 'Linear',
          });
          this.activeTweens.push(fadeTween as unknown as { stop: () => void });
        });
        this.activeTweens.push({ stop: () => holdTimer.remove() });
      },
    });
    this.activeTweens.push(growTween as unknown as { stop: () => void });
  }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/entities/__tests__/PlayerOutro.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/entities/PlayerOutro.ts src/entities/__tests__/PlayerOutro.test.ts
git commit -m "feat(outro): starburst twinkle at t=2400ms"
```

---

## Task 9: Wire PlayerOutro Into GameScene Trash-Wall Death

**Files:**
- Modify: `src/scenes/GameScene.ts:184-227`

- [ ] **Step 1: Add the import + field**

In `src/scenes/GameScene.ts`, near the existing PlayerAnimator import (line 3):

```typescript
import { PlayerOutro } from '../entities/PlayerOutro';
```

Near line 51 where `private playerAnimator!: PlayerAnimator;` is declared, add:

```typescript
  private playerOutro!: PlayerOutro;
```

Where `playerAnimator` is instantiated (line 166):

```typescript
    this.playerAnimator = new PlayerAnimator(this.player.sprite, this);
    this.playerOutro    = new PlayerOutro(this, this.player.sprite);
```

- [ ] **Step 2: Replace the trash-wall death callback**

The current callback at line 184-227 freezes the player, calls `playerAnimator.update(..., justDied: true)`, then in an 800ms `delayedCall` builds the score and launches ScoreScene. Replace the entire `() => { ... }` body of the `new TrashWallManager(this, TRASH_WALL_DEF, ...)` constructor call with:

```typescript
() => {
  this._playerDead = true;
  AudioManager.onPlayerDeath();
  this.player.freeze();
  this.playerAnimator.update(0.016, { ...this.player.animState, justDied: true });
  this.player.sprite.setDepth(4); // visually swallowed — below wall body (depth 5)

  this.playerOutro.play('death', () => {
    const checkpointAvailable = getPlaced(this._heapId).some(
      p => p.id === 'checkpoint' && (p.meta?.spawnsLeft ?? 0) > 0,
    );
    const baseHeightPx = Math.max(0, Math.floor(this.spawnY - this.player.sprite.y));
    const elapsedMs    = this._runStartTime !== null ? (this.time.now - this._runStartTime) : 0;
    const runResult    = buildRunScore(
      { baseHeightPx, kills: this._runKills, elapsedMs },
      ENEMY_DEFS,
      true,
      this._heapParams.scoreMult,
    );
    const killCount = Object.values(this._runKills).reduce((sum, val) => sum + val, 0);
    getLogger().event({
      type: 'run:end',
      heapId: this._heapId,
      mode: 'normal',
      score: runResult.finalScore,
      height: baseHeightPx,
      kills: killCount,
      durationMs: elapsedMs,
      cause: 'death',
      upgrades: getUpgrades(),
    });
    this.scene.launch('ScoreScene', {
      score:        runResult.finalScore,
      heapId:       this._heapId,
      isPeak:       false,
      checkpointAvailable,
      isFailure:    true,
      baseHeightPx,
      kills:        this._runKills,
      elapsedMs,
      heapParams:   this._heapParams,
    });
    this.scene.pause();
  });
}
```

The previous `this.time.delayedCall(800, ...)` wrapper is gone — the outro provides the timing.

- [ ] **Step 3: Run build + tests**

Run: `npm run build && npm test`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/scenes/GameScene.ts
git commit -m "feat(game): trash-wall death uses PlayerOutro"
```

---

## Task 10: Wire PlayerOutro Into GameScene Enemy-Damage Death

**Files:**
- Modify: `src/scenes/GameScene.ts:612-662`

- [ ] **Step 1: Replace handleEnemyDamage's launch block**

In `src/scenes/GameScene.ts`, the `handleEnemyDamage` method (around line 612) currently calls `scene.launch('ScoreScene', ...)` then `scene.pause()` synchronously after marking the player dead. Wrap the launch in the outro:

Find the block starting at `if (this._playerDead) return;` (line 621) and ending at `this.scene.pause();` (line 661). Replace from `this.playerAnimator.update(0.016, ...)` onward with:

```typescript
    if (this._playerDead) return;
    this._playerDead = true;
    AudioManager.onPlayerDeath();
    this.player.freeze();
    this.playerAnimator.update(0.016, { ...this.player.animState, justDied: true });

    this.playerOutro.play('death', () => {
      const checkpointAvailable = getPlaced(this._heapId).some(
        p => p.id === 'checkpoint' && (p.meta?.spawnsLeft ?? 0) > 0,
      );
      const baseHeightPx = Math.max(0, Math.floor(this.spawnY - this.player.sprite.y));
      const elapsedMs    = this._runStartTime !== null ? (this.time.now - this._runStartTime) : 0;
      const runResult    = buildRunScore(
        { baseHeightPx, kills: this._runKills, elapsedMs },
        ENEMY_DEFS,
        true,
        this._heapParams.scoreMult,
      );
      const killCount = Object.values(this._runKills).reduce((sum, val) => sum + val, 0);
      getLogger().event({
        type: 'run:end',
        heapId: this._heapId,
        mode: 'normal',
        score: runResult.finalScore,
        height: baseHeightPx,
        kills: killCount,
        durationMs: elapsedMs,
        cause: 'death',
        upgrades: getUpgrades(),
      });
      this.scene.launch('ScoreScene', {
        score:        runResult.finalScore,
        heapId:       this._heapId,
        isPeak:       false,
        checkpointAvailable,
        isFailure:    true,
        baseHeightPx,
        kills:        this._runKills,
        elapsedMs,
        heapParams:   this._heapParams,
      });
      this.scene.pause();
    });
```

- [ ] **Step 2: Run build + tests**

Run: `npm run build && npm test`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/scenes/GameScene.ts
git commit -m "feat(game): enemy-damage death uses PlayerOutro"
```

---

## Task 11: Wire PlayerOutro Into GameScene Placement Success

**Files:**
- Modify: `src/scenes/GameScene.ts:494-547`

- [ ] **Step 1: Replace the placeBlock delayedCall**

In `src/scenes/GameScene.ts`, the `placeBlock()` method (around line 494) currently uses `this.time.delayedCall(2000, () => { ... })` to wait before launching ScoreScene. Replace that delayedCall with the outro. The interior of `placeBlock()` from the `this.time.delayedCall(2000, ...)` line through its closing `});` becomes:

```typescript
    this.player.freeze();
    this.playerAnimator.update(0.016, { ...this.player.animState, justPlaced: true });

    this.playerOutro.play('success', () => {
      void appendDone.then(() => {
        const killCount = Object.values(this._runKills).reduce((sum, val) => sum + val, 0);
        getLogger().event({
          type: 'run:end',
          heapId: this._heapId,
          mode: 'normal',
          score: runResult.finalScore,
          height: baseHeightPx,
          kills: killCount,
          durationMs: elapsedMs,
          cause: 'quit',
          upgrades: getUpgrades(),
        });
        this.scene.launch('ScoreScene', {
          score:        runResult.finalScore,
          heapId:       this._heapId,
          isPeak,
          baseHeightPx,
          kills:        this._runKills,
          elapsedMs,
          heapParams:   this._heapParams,
          bonusCoins:   bonusCoinsFromServer,
        });
        this.scene.pause();
      });
    });
```

- [ ] **Step 2: Run build + tests**

Run: `npm run build && npm test`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/scenes/GameScene.ts
git commit -m "feat(game): placement success uses PlayerOutro"
```

---

## Task 12: Wire PlayerOutro Into InfiniteGameScene Death

**Files:**
- Modify: `src/scenes/InfiniteGameScene.ts:412, 434`

- [ ] **Step 1: Add import + field + instantiation**

In `src/scenes/InfiniteGameScene.ts`, add the import alongside the existing `PlayerAnimator` import:

```typescript
import { PlayerOutro } from '../entities/PlayerOutro';
```

Find the `private playerAnimator!: PlayerAnimator;` declaration (around line 64) and add:

```typescript
  private playerOutro!: PlayerOutro;
```

Find where `playerAnimator` is instantiated (around line 160) and add right after:

```typescript
    this.playerOutro = new PlayerOutro(this, this.player.sprite);
```

- [ ] **Step 2: Replace handleDeath's delayedCall with the outro**

In `src/scenes/InfiniteGameScene.ts`, the `handleDeath()` method (line 406-452) currently uses `this.time.delayedCall(800, () => { ... })` before launching ScoreScene. Replace the entire method body from the existing `this.playerAnimator.update(...)` call onward with:

```typescript
  private handleDeath(): void {
    if (!this.scene.isActive()) return;
    if (this._playerDead) return;
    this._playerDead = true;
    AudioManager.onPlayerDeath();
    this.player.freeze();
    this.playerAnimator.update(0, { ...this.player.animState, justDied: true });
    const score      = Math.max(0, Math.floor(this.spawnY - this.player.sprite.y));
    const elapsedMs  = this._runStartTime !== null ? this.time.now - this._runStartTime : 0;
    const runResult  = buildRunScore(
      { baseHeightPx: score, kills: this._runKills, elapsedMs },
      ENEMY_DEFS,
      true,
      1.0,
    );

    this.playerOutro.play('death', () => {
      const killCount = Object.values(this._runKills).reduce((sum, val) => sum + val, 0);
      getLogger().event({
        type: 'run:end',
        heapId: INFINITE_HEAP_ID,
        mode: 'infinite',
        score: runResult.finalScore,
        height: score,
        kills: killCount,
        durationMs: elapsedMs,
        cause: 'death',
        upgrades: getUpgrades(),
      });
      this.scene.launch('ScoreScene', {
        score:               runResult.finalScore,
        heapId:              INFINITE_HEAP_ID,
        isPeak:              false,
        checkpointAvailable: false,
        isFailure:           true,
        baseHeightPx:        score,
        kills:               this._runKills,
        elapsedMs,
        heapParams: {
          ...DEFAULT_HEAP_PARAMS,
          name: '∞ Infinite Heap',
          difficulty: 5.0,
          isInfinite: true,
        },
      });
      this.scene.sleep();
    });
  }
```

Note: `scene.sleep()` not `scene.pause()` — match InfiniteGameScene's existing pattern. The score/runResult computation stays outside the outro callback (same as the existing code) because both depend on the player's death position, which is captured before the outro starts.

- [ ] **Step 3: Run build + tests**

Run: `npm run build && npm test`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/scenes/InfiniteGameScene.ts
git commit -m "feat(infinite): death uses PlayerOutro"
```

---

## Task 13: Add Dev-Mode Outro Preview Trigger

BootScene already passes `?dev=Scene&params={...}` JSON through to the scene's init data (see `src/scenes/BootScene.ts:70-84`). No BootScene change needed — GameScene just needs to read a `_devOutro` field from its init data and auto-fire the outro.

The URL for visual preview becomes: `?dev=GameScene&params={"_devOutro":"death"}` (or `"success"`).

**Files:**
- Modify: `src/scenes/GameScene.ts`

- [ ] **Step 1: Make GameScene fire the outro when `_devOutro` init data is present**

In `src/scenes/GameScene.ts`, in `create()` at the very end (after `playerOutro` is instantiated and after all other setup), add:

```typescript
    const initData = this.scene.settings.data as { _devOutro?: 'death' | 'success' } | undefined;
    if (initData?._devOutro) {
      const kind = initData._devOutro;
      this.time.delayedCall(500, () => {
        this.player.freeze();
        this.playerAnimator.update(0.016, {
          ...this.player.animState,
          ...(kind === 'death' ? { justDied: true } : { justPlaced: true }),
        });
        this.playerOutro.play(kind, () => {
          // dev preview: do not launch ScoreScene; leave the post-outro frame visible
        });
      });
    }
```

- [ ] **Step 2: Run build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/scenes/GameScene.ts
git commit -m "feat(dev): support _devOutro init data for outro preview"
```

---

## Task 14: Visual Verification + Final Build/Test Gate

This task uses the `heap-scene-preview` skill (per CLAUDE.md) to capture both outros, plus the standard build/test gate before claiming the feature is complete.

- [ ] **Step 1: Start the dev server in a background terminal**

Run: `npm run dev`

(Leave running.)

- [ ] **Step 2: Capture the death outro**

Run: `npm run scene-preview -- GameScene '{"_devOutro":"death"}' pixel7`

Read `screenshots/preview.png`. Expected: black-fading screen with white radial gradient around proxy at center, mid-shrink or post-pop depending on capture timing. If the script's argument syntax is different from `<SceneName> <jsonParams> <devicePreset>`, check `package.json`'s `scripts.scene-preview` and adapt.

- [ ] **Step 3: Capture the success outro**

Run: `npm run scene-preview -- GameScene '{"_devOutro":"success"}' pixel7`

Read `screenshots/preview.png`. Expected: gold-tinted screen with gold gradient around proxy at top-center.

- [ ] **Step 4: Confirm both screenshots look right**

If either screenshot is broken (no overlay drawing, wrong colors, proxy in wrong place, etc.), STOP and debug. Do not proceed to commit.

- [ ] **Step 5: Run final build + tests**

Run: `npm run build && npm test`

Expected: PASS.

- [ ] **Step 6: Manual smoke test in browser**

Open http://localhost:3000 in the browser. Play a real game:
1. Die to an enemy → verify the death outro plays (drift to center, fade to black, squish, shrink, white starburst, score scene appears).
2. Die to the trash wall → same.
3. Place a block successfully → verify the success outro plays (drift to top, gold tint, joyful squish, shrink, gold starburst, score scene appears).
4. Tap during any outro → verify it hard-cuts to score scene immediately.

If any of the above misbehaves, STOP and debug.

- [ ] **Step 7: Commit any final polish**

If smoke test surfaced minor tuning (e.g., timing, color), apply tweaks and commit:

```bash
git add -p
git commit -m "fix(outro): <specific tweak>"
```

- [ ] **Step 8: Push the branch**

Run: `git push -u origin feature/player-outro-animation`

Then offer to open a PR (per project convention — confirm with user before creating).

---

## Notes

- **Bow strings:** The player's bow-string graphics (rendered by `PlayerAnimator` via a separate `Graphics` synced on POST_UPDATE) are not transferred to the proxy. They disappear at outro start because the in-world sprite is hidden. This is per §7 of the spec — re-drawing strings on the proxy in screen-space is deferred as future polish.
- **Physics resume:** PlayerOutro pauses physics but does not resume it. Resumption happens implicitly when GameScene is paused and ScoreScene takes over the display list; if a future use case starts GameScene back up (e.g. checkpoint), that consumer is responsible for `scene.physics.world.resume()`.
- **Idempotent onComplete:** Critical — both the natural-completion timer and the skip path call `finish()`, which is gated by `this.completed`. Tests cover this.
- **No audio:** Per spec §7, audio cues are deferred. Coordinate with AudioManager in a future follow-up.
