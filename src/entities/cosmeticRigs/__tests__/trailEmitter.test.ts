import { describe, it, expect } from 'vitest';
import { trailEmitterConfig } from '../trailEmitter';
import { getCosmeticDef, type TrailRender } from '../../../data/cosmeticDefs';

const embers = getCosmeticDef('trail_embers')!.render as TrailRender;
const rainbow = getCosmeticDef('trail_rainbow')!.render as TrailRender;

describe('trailEmitterConfig', () => {
  it('with no options, reproduces the in-game trail exactly', () => {
    // The portraits share this builder with the running game; if the defaults
    // drift, every trail changes for everyone.
    const cfg = trailEmitterConfig(embers, () => 0);
    expect(cfg.tint).toBe(embers.tint);
    expect(cfg.frequency).toBe(embers.frequency);
    expect(cfg.speedX).toEqual({ min: -20, max: 20 });
    expect(cfg.speedY).toEqual({ min: embers.speedY[0], max: embers.speedY[1] });
    expect(cfg.lifespan).toBe(embers.lifespan);
    expect(cfg.scale).toEqual({ start: embers.scale[0], end: embers.scale[1] });
    expect(cfg.alpha).toEqual({ start: embers.alpha, end: 0 });
  });

  it('drift shifts the whole spread without flattening the item motion', () => {
    const cfg = trailEmitterConfig(embers, () => 0, { driftX: -45, driftY: -35 });
    const sx = cfg.speedX as { min: number; max: number };
    const sy = cfg.speedY as { min: number; max: number };
    expect(sx.max).toBeLessThan(0);                       // always leftward
    expect(sx.max - sx.min).toBe(40);                     // spread preserved
    expect(sy.max - sy.min).toBe(embers.speedY[1] - embers.speedY[0]);
    expect(sy.max).toBeLessThan(embers.speedY[1]);        // shifted upward
  });

  it('scale multiplies both size and speed', () => {
    const cfg = trailEmitterConfig(embers, () => 0, { scale: 3 });
    expect((cfg.scale as { start: number }).start).toBeCloseTo(embers.scale[0] * 3);
    expect((cfg.speedX as { max: number }).max).toBe(60);
  });

  it('a rainbow trail reads the clock at emit time, not build time', () => {
    let now = 0;
    const cfg = trailEmitterConfig(rainbow, () => now);
    const onEmit = (cfg.tint as { onEmit: () => number }).onEmit;
    const first = onEmit();
    now = 200;
    expect(onEmit()).not.toBe(first);
  });

  it('walks a full spectrum within one particle lifetime', () => {
    let now = 0;
    const cfg = trailEmitterConfig(rainbow, () => now);
    const onEmit = (cfg.tint as { onEmit: () => number }).onEmit;
    const hues = new Set<number>();
    // Sample across exactly one lifespan — the live streak's worth of particles.
    for (let i = 0; i < 6; i++) { now = (i / 6) * rainbow.lifespan; hues.add(onEmit()); }
    expect(hues.size).toBe(6);
    // A full cycle means the ends meet up again.
    now = rainbow.lifespan;
    expect(onEmit()).toBe([...hues][0]);
  });
});
