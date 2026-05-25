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
      (t.config as { fadeAlpha?: { from?: number; to?: number } }).fadeAlpha?.to === 1
      && (t.config as { duration?: number }).duration === 1800,
    );
    expect(fadeTween).toBeDefined();
  });

  it('play("success") tweens fade alpha 0→0.6 over the drift window (1800ms)', () => {
    outro.play('success', vi.fn());
    const fadeTween = stub.tweens.find(t =>
      (t.config as { fadeAlpha?: { from?: number; to?: number } }).fadeAlpha?.to === 0.6
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
    // Screen is 480x854; top-center is 240, 128 (Math.floor(854 * 0.15) = 128)
    outro.play('success', vi.fn());
    const driftTween = stub.tweens.find(t => {
      const cfg = t.config as { x?: { to?: number }; y?: { to?: number }; duration?: number };
      return cfg.duration === 1800 && cfg.x?.to === 240 && Math.abs((cfg.y?.to ?? 0) - 128) <= 1;
    });
    expect(driftTween).toBeDefined();
  });
});

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
