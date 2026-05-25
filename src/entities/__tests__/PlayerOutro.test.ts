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
    expect(stub.scene.input.off).toHaveBeenCalled();
  });

  it('play() throws if called twice without destroy or completion', () => {
    outro.play('death', onComplete);
    expect(() => outro.play('death', onComplete)).toThrow();
  });
});

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
