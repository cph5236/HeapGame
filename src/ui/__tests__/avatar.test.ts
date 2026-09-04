/**
 * avatar.test.ts — portrait lifecycle.
 *
 * Every player portrait is live now: it holds a scene UPDATE listener that
 * ticks attachment rigs and the rainbow hue cycle. That is the same shape as
 * the production P1 crash in PlayerCosmetics — Phaser's Systems.shutdown()
 * emits SHUTDOWN *without* clearing listeners, so a listener that only comes
 * off on an explicit destroy() outlives the scene and then ticks GameObjects
 * Phaser has already destroyed. Most callers here never call destroy(): they
 * hand the container to a parent (leaderboard rows, podium) or just leave the
 * scene. So the unsubscribe paths are what these tests pin down.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scenes:      { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

const rigUpdate = vi.fn();
const rigDestroy = vi.fn();
vi.mock('../../entities/cosmeticRigs/createAttachmentRig', () => ({
  createAttachmentRig: vi.fn(() => ({
    objects: [], update: rigUpdate, setVisible: vi.fn(), destroy: rigDestroy,
  })),
}));

import { createAvatar, composeAvatar } from '../avatar';

type Handler = (...args: unknown[]) => void;

/** Minimal stand-in for Phaser's EventEmitter, with the `once` semantics used. */
function makeEmitter() {
  const listeners: Array<{ event: string; fn: Handler; once: boolean }> = [];
  return {
    listeners,
    on(event: string, fn: Handler) { listeners.push({ event, fn, once: false }); },
    once(event: string, fn: Handler) { listeners.push({ event, fn, once: true }); },
    off(event: string, fn: Handler) {
      for (let i = listeners.length - 1; i >= 0; i--) {
        if (listeners[i].event === event && listeners[i].fn === fn) listeners.splice(i, 1);
      }
    },
    emit(event: string, ...args: unknown[]) {
      for (const l of [...listeners]) {
        if (l.event !== event) continue;
        if (l.once) this.off(l.event, l.fn);
        l.fn(...args);
      }
    },
    countOf(event: string) { return listeners.filter(l => l.event === event).length; },
  };
}

/** Container stub: its own emitter, so DESTROY can be fired independently. */
function makeContainer() {
  const events = makeEmitter();
  return {
    events,
    added: [] as unknown[],
    add(o: unknown) { this.added.push(o); return this; },
    once(event: string, fn: Handler) { events.once(event, fn); return this; },
    off(event: string, fn: Handler) { events.off(event, fn); return this; },
    setDepth: vi.fn().mockReturnThis(),
    setAlpha: vi.fn().mockReturnThis(),
    destroy() { events.emit('destroy'); },
  };
}

function makeScene() {
  const events = makeEmitter();
  const container = makeContainer();
  const gfx = {
    clear: vi.fn().mockReturnThis(), fillStyle: vi.fn().mockReturnThis(),
    fillEllipse: vi.fn().mockReturnThis(), lineStyle: vi.fn().mockReturnThis(),
    beginPath: vi.fn().mockReturnThis(), moveTo: vi.fn().mockReturnThis(),
    lineTo: vi.fn().mockReturnThis(), strokePath: vi.fn().mockReturnThis(),
  };
  return {
    events,
    container,
    textures: { exists: () => true },
    add: {
      container: vi.fn(() => container),
      graphics:  vi.fn(() => gfx),
      image:     vi.fn(() => ({
        setDisplaySize: vi.fn().mockReturnThis(),
        setTint:        vi.fn().mockReturnThis(),
        setTintFill:    vi.fn().mockReturnThis(),
        setAlpha:       vi.fn().mockReturnThis(),
      })),
      particles: vi.fn(() => ({ setDepth: vi.fn().mockReturnThis() })),
    },
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const OPTS = { x: 0, y: 0, scale: 2 };

describe('avatar portraits are live', () => {
  it('ticks its rigs on scene UPDATE', () => {
    const scene = makeScene();
    rigUpdate.mockClear();
    createAvatar(scene as any, { hat: 'hat_propeller' }, OPTS);

    scene.events.emit('update', 0, 16);
    expect(rigUpdate).toHaveBeenCalled();
  });

  it('unsubscribes when the scene shuts down', () => {
    const scene = makeScene();
    createAvatar(scene as any, { hat: 'hat_propeller' }, OPTS);
    expect(scene.events.countOf('update')).toBe(1);

    scene.events.emit('shutdown');
    expect(scene.events.countOf('update')).toBe(0);
  });

  it('unsubscribes when its container is destroyed by a parent', () => {
    // The leaderboard/podium path: the caller never holds a handle, it just
    // adds the container to a row and lets that row's teardown destroy it.
    const scene = makeScene();
    const container = composeAvatar(scene as any, { hat: 'hat_propeller' }, OPTS);
    expect(scene.events.countOf('update')).toBe(1);

    (container as any).destroy();
    expect(scene.events.countOf('update')).toBe(0);
  });

  it('never ticks again after teardown, however the scene is pumped', () => {
    const scene = makeScene();
    createAvatar(scene as any, { hat: 'hat_propeller' }, OPTS);
    scene.events.emit('shutdown');

    rigUpdate.mockClear();
    scene.events.emit('update', 0, 16);
    expect(rigUpdate).not.toHaveBeenCalled();
  });

  it('destroy() is idempotent across both teardown paths', () => {
    const scene = makeScene();
    const handle = createAvatar(scene as any, { hat: 'hat_propeller' }, OPTS);
    handle.destroy();
    expect(() => scene.events.emit('shutdown')).not.toThrow();
    expect(() => handle.destroy()).not.toThrow();
    expect(scene.events.listeners).toHaveLength(0);
  });

  it('repaints a rainbow tie as time passes', () => {
    const scene = makeScene();
    createAvatar(scene as any, { tie: 'tie_rainbow' }, OPTS);
    const gfx = (scene.add.graphics as any).mock.results[0].value;

    scene.events.emit('update', 0, 500);
    const first = gfx.lineStyle.mock.calls.length;
    scene.events.emit('update', 0, 500);
    expect(gfx.lineStyle.mock.calls.length).toBeGreaterThan(first);
    // Two different points in the cycle must not paint the same color.
    const colors = gfx.lineStyle.mock.calls.map((c: number[]) => c[1]);
    expect(new Set(colors).size).toBeGreaterThan(1);
  });

  it('leaves a flat tie alone once painted', () => {
    const scene = makeScene();
    createAvatar(scene as any, { tie: 'tie_gold' }, OPTS);
    const gfx = (scene.add.graphics as any).mock.results[0].value;
    const atBuild = gfx.lineStyle.mock.calls.length;

    scene.events.emit('update', 0, 500);
    expect(gfx.lineStyle.mock.calls.length).toBe(atBuild);
  });
});

describe('avatar trail', () => {
  it('is off by default — a leaderboard row is not a showcase', () => {
    const scene = makeScene();
    createAvatar(scene as any, { trail: 'trail_embers' }, OPTS);
    expect(scene.add.particles).not.toHaveBeenCalled();
  });

  it('streams up and to the left when asked for, scaled to the portrait', () => {
    const scene = makeScene();
    createAvatar(scene as any, { trail: 'trail_embers' }, { ...OPTS, trail: true });
    expect(scene.add.particles).toHaveBeenCalled();

    const [x, y, key, cfg] = (scene.add.particles as any).mock.calls[0];
    expect(key).toBe('cos-dot');
    // Born off the left shoulder, not in the middle of the bag: a particle
    // that spawns behind the silhouette is already faded by the time it clears.
    expect(x).toBeLessThan(0);
    expect(cfg.speedX.max).toBeLessThan(0);  // every particle drifts left…
    expect(cfg.speedY.max).toBeLessThan(0);  // …and up
    // Particle size tracks the portrait scale, or the trail reads as dust.
    expect(cfg.scale.start).toBeGreaterThan(1.0);
    // …and outlives the game-tuned lifespan, since the mannequin never moves.
    expect(cfg.lifespan).toBeGreaterThan(750);
    expect(y).toBeTypeOf('number');
  });

  it('renders behind the bag', () => {
    const scene = makeScene();
    createAvatar(scene as any, { trail: 'trail_embers' }, { ...OPTS, trail: true });
    // Container children paint in insertion order — the emitter goes in first.
    expect(scene.container.added[0]).toBe((scene.add.particles as any).mock.results[0].value);
  });
});
