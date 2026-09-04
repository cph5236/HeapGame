/**
 * PlayerCosmetics.test.ts — lifecycle regression tests.
 *
 * Covers the production crash "Cannot read properties of undefined (reading
 * 'velocity')" in PlayerCosmetics.sync (Todo/Crash_Reports.md, P1).
 *
 * The bug: the constructor subscribes `sync` to POST_UPDATE and only `destroy()`
 * unsubscribes — but Phaser never invokes a Scene's `shutdown()` method (it only
 * auto-calls init/preload/create/update), and `Systems.shutdown()` emits SHUTDOWN
 * *without* clearing listeners. So the listener outlived the scene, and on that
 * scene's next run it fired against a sprite Phaser had already destroyed, whose
 * `body` is set to undefined by GameObject.destroy().
 *
 * Strategy: mock `phaser` down to the two event-name constants the class reads,
 * and drive a hand-rolled emitter that behaves like scene.events.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { POST_UPDATE: 'postupdate', SHUTDOWN: 'shutdown' } },
  },
}));

// Keep the rigs out of it — this suite is about listener lifecycle, not art.
vi.mock('../cosmeticRigs/createAttachmentRig', () => ({
  createAttachmentRig: vi.fn(() => ({
    update: vi.fn(), setVisible: vi.fn(), destroy: vi.fn(),
  })),
}));

import { PlayerCosmetics } from '../PlayerCosmetics';
import type { ResolvedCosmetics } from '../../systems/cosmeticsLogic';

// ── Stubs ─────────────────────────────────────────────────────────────────────

type Handler = (...args: unknown[]) => void;

/** Minimal stand-in for Phaser's EventEmitter, with the `once` semantics used. */
function makeEmitter() {
  const listeners: Array<{ event: string; fn: Handler; ctx: unknown; once: boolean }> = [];
  return {
    listeners,
    on(event: string, fn: Handler, ctx: unknown) { listeners.push({ event, fn, ctx, once: false }); },
    once(event: string, fn: Handler, ctx: unknown) { listeners.push({ event, fn, ctx, once: true }); },
    off(event: string, fn: Handler, ctx: unknown) {
      for (let i = listeners.length - 1; i >= 0; i--) {
        const l = listeners[i];
        if (l.event === event && l.fn === fn && l.ctx === ctx) listeners.splice(i, 1);
      }
    },
    emit(event: string, ...args: unknown[]) {
      for (const l of [...listeners]) {
        if (l.event !== event) continue;
        if (l.once) this.off(l.event, l.fn, l.ctx);
        l.fn.apply(l.ctx, args);
      }
    },
    countOf(event: string) { return listeners.filter(l => l.event === event).length; },
  };
}

function makeBody() {
  return {
    velocity: { x: 0, y: 0 },
    blocked:  { down: false },
    touching: { down: false },
  };
}

/** Sprite with a live physics body, as it exists during a run. */
function makeSprite() {
  return {
    x: 10, y: 20, angle: 0, scaleX: 1, scaleY: 1,
    depth: 5, visible: true, flipX: false, flipY: false,
    texture: { key: 'player' },
    frame: { name: '__BASE' },
    body: makeBody() as ReturnType<typeof makeBody> | undefined,
    setTint: vi.fn(),
  };
}

function makeScene(events: ReturnType<typeof makeEmitter>) {
  return {
    events,
    add: {
      image: vi.fn(() => ({
        setTintFill: vi.fn().mockReturnThis(),
        setAlpha:    vi.fn().mockReturnThis(),
        setDepth:    vi.fn().mockReturnThis(),
        setPosition: vi.fn().mockReturnThis(),
        setScale:    vi.fn().mockReturnThis(),
        setAngle:    vi.fn().mockReturnThis(),
        setFlip:     vi.fn().mockReturnThis(),
        setVisible:  vi.fn().mockReturnThis(),
        setTexture:  vi.fn().mockReturnThis(),
        destroy:     vi.fn(),
      })),
      particles: vi.fn(() => ({
        setDepth:    vi.fn().mockReturnThis(),
        startFollow: vi.fn().mockReturnThis(),
        start:       vi.fn(),
        stop:        vi.fn(),
        emitting:    false,
        destroy:     vi.fn(),
      })),
    },
  };
}

const PLAIN: ResolvedCosmetics = {
  tieColor: 0xff0000, tieRainbow: false,
  skinTint: null, skinRainbow: false, hat: null, face: null, trail: null,
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function construct(resolved: ResolvedCosmetics = PLAIN) {
  const events = makeEmitter();
  const scene  = makeScene(events);
  const sprite = makeSprite();
  const cos = new PlayerCosmetics(sprite as any, scene as any, resolved);
  return { cos, events, scene, sprite };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PlayerCosmetics lifecycle', () => {
  let ctx: ReturnType<typeof construct>;
  beforeEach(() => { ctx = construct(); });

  it('subscribes sync to POST_UPDATE', () => {
    expect(ctx.events.countOf('postupdate')).toBe(1);
    expect(() => ctx.events.emit('postupdate', 0, 16)).not.toThrow();
  });

  it('does not throw when the sprite body is gone (the P1 crash)', () => {
    // GameObject.destroy() sets `body` to undefined — reproduce that exactly.
    ctx.sprite.body = undefined;
    expect(() => ctx.events.emit('postupdate', 0, 16)).not.toThrow();
  });

  it('unsubscribes from POST_UPDATE on scene SHUTDOWN', () => {
    ctx.events.emit('shutdown');
    expect(ctx.events.countOf('postupdate')).toBe(0);
  });

  it('never fires against a destroyed sprite after the scene restarts', () => {
    // Scene stops: Phaser destroys the display list, then emits SHUTDOWN.
    ctx.sprite.body = undefined;
    ctx.events.emit('shutdown');
    // Scene starts again and pumps frames — the stale listener must be gone.
    expect(() => ctx.events.emit('postupdate', 0, 16)).not.toThrow();
    expect(ctx.events.listeners).toHaveLength(0);
  });

  it('leaves no listeners behind after destroy()', () => {
    ctx.cos.destroy();
    expect(ctx.events.listeners).toHaveLength(0);
  });

  it('destroy() is idempotent across both teardown paths', () => {
    ctx.cos.destroy();
    expect(() => ctx.events.emit('shutdown')).not.toThrow();
    expect(() => ctx.cos.destroy()).not.toThrow();
  });

  it('hide() stops sync from touching the body at all', () => {
    ctx.cos.hide();
    ctx.sprite.body = undefined;
    expect(() => ctx.events.emit('postupdate', 0, 16)).not.toThrow();
  });
});

// ── Skin glaze tracks the bag's current art ───────────────────────────────────

describe('PlayerCosmetics skin glaze', () => {
  const TINTED: ResolvedCosmetics = {
    tieColor: 0xff0000, tieRainbow: false,
    skinTint: 0x00ff00, skinRainbow: false, hat: null, face: null, trail: null,
  };

  it('follows the sprite onto the dash frames', () => {
    const { events, scene, sprite } = construct(TINTED);
    const glaze = (scene.add.image as any).mock.results[0].value;

    // PlayerAnimator hands the bag to the dash spritesheet mid-run.
    sprite.texture.key = 'trashbag-dash';
    sprite.frame.name  = '2';
    events.emit('postupdate', 0, 16);

    expect(glaze.setTexture).toHaveBeenCalledWith('trashbag-dash', '2');
  });
});

// ── Rainbow items cycle hue instead of sitting on their fallback color ────────

const TRAIL = {
  kind: 'trail' as const, textureKey: 'cos-dot', tint: 0xff0000, frequency: 40,
  speedY: [-10, 10] as [number, number], lifespan: 500,
  scale: [1.4, 0.2] as [number, number], alpha: 0.9,
};

describe('PlayerCosmetics rainbow', () => {
  const RAINBOW_SKIN: ResolvedCosmetics = {
    tieColor: 0xff0000, tieRainbow: false,
    skinTint: 0xff0000, skinRainbow: true, hat: null, face: null, trail: null,
  };

  it('re-tints the bag and its glaze together as time passes', () => {
    const { events, scene, sprite } = construct(RAINBOW_SKIN);
    const glaze = (scene.add.image as any).mock.results[0].value;

    const lastTint = () => {
      const calls = sprite.setTint.mock.calls;
      return calls[calls.length - 1][0];
    };

    events.emit('postupdate', 0, 500);
    const bagFirst = lastTint();
    const glazeCalls = glaze.setTintFill.mock.calls;
    expect(glazeCalls[glazeCalls.length - 1][0]).toBe(bagFirst);   // layers never drift apart

    events.emit('postupdate', 0, 500);
    expect(lastTint()).not.toBe(bagFirst);
  });

  it('leaves a non-rainbow skin on its flat tint', () => {
    const { events, sprite } = construct({
      ...RAINBOW_SKIN, skinRainbow: false,
    });
    const atBuild = sprite.setTint.mock.calls.length;
    events.emit('postupdate', 0, 500);
    expect(sprite.setTint.mock.calls.length).toBe(atBuild);
  });

  it('gives the rainbow trail a per-particle tint callback, not a flat color', () => {
    const { scene } = construct({
      ...PLAIN, trail: { ...TRAIL, rainbow: true },
    });
    const cfg = (scene.add.particles as any).mock.calls[0][3];
    // A flat number here would tint every particle identically for the whole
    // run; the hue has to be a callback the emitter re-reads per particle.
    expect(typeof cfg.tint).not.toBe('number');
    expect(typeof cfg.tint.onEmit).toBe('function');
    const hue = cfg.tint.onEmit();
    expect(Number.isInteger(hue)).toBe(true);
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThanOrEqual(0xffffff);
    // That the hue actually MOVES is the next test's job — two calls with no
    // time advanced between them are supposed to agree.
  });

  it('walks the hue as the run progresses, so the streak holds a spectrum', () => {
    const { events, scene } = construct({
      ...PLAIN, trail: { ...TRAIL, rainbow: true },
    });
    const cfg = (scene.add.particles as any).mock.calls[0][3];
    const first = cfg.tint.onEmit();
    events.emit('postupdate', 0, 40);      // one emission interval later
    expect(cfg.tint.onEmit()).not.toBe(first);
  });

  it('keeps a non-rainbow trail on its flat tint', () => {
    const { scene } = construct({ ...PLAIN, trail: TRAIL });
    const cfg = (scene.add.particles as any).mock.calls[0][3];
    expect(cfg.tint).toBe(0xff0000);
  });
});
