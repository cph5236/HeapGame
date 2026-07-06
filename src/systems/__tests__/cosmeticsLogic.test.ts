import { describe, it, expect } from 'vitest';
import { resolveCosmetics, rainbowColorAt } from '../cosmeticsLogic';

describe('resolveCosmetics', () => {
  it('empty loadout resolves to defaults', () => {
    const r = resolveCosmetics({});
    expect(r.tieColor).toBe(0xff0000);
    expect(r.tieRainbow).toBe(false);
    expect(r.skinTint).toBeNull();
    expect(r.hat).toBeNull();
    expect(r.face).toBeNull();
    expect(r.trail).toBeNull();
  });

  it('resolves equipped items to their render specs', () => {
    const r = resolveCosmetics({ tie: 'tie_gold', skin: 'skin_toxic', hat: 'hat_cone', face: 'face_googly', trail: 'trail_flies' });
    expect(r.tieColor).toBe(0xd9a520);
    expect(r.skinTint).toBe(0x88dd66);
    expect(r.hat?.textureKey).toBe('cos-hat_cone');
    expect(r.face?.textureKey).toBe('cos-face_googly');
    expect(r.trail?.textureKey).toBe('cos-fly');
  });

  it('skin_default resolves to no tint', () => {
    expect(resolveCosmetics({ skin: 'skin_default' }).skinTint).toBeNull();
  });

  it('rainbow tie sets the flag', () => {
    expect(resolveCosmetics({ tie: 'tie_rainbow' }).tieRainbow).toBe(true);
  });

  it('ignores stale/unknown ids (e.g. removed items in an old save)', () => {
    const r = resolveCosmetics({ hat: 'hat_removed', tie: 'nope' } as never);
    expect(r.hat).toBeNull();
    expect(r.tieColor).toBe(0xff0000);
  });
});

describe('hat adjustments', () => {
  it('applies dAngle/dScale on top of the def defaults', () => {
    const r = resolveCosmetics({ hat: 'hat_fedora' }, { hat_fedora: { dAngle: 5, dScale: 1.1 } });
    expect(r.hat?.angle).toBe(5);
    expect(r.hat?.scale).toBeCloseTo(1.1);
  });

  it('clamps out-of-range adjustments (±15°, ×0.8–1.2)', () => {
    const r = resolveCosmetics({ hat: 'hat_fedora' }, { hat_fedora: { dAngle: 40, dScale: 3 } });
    expect(r.hat?.angle).toBe(15);
    expect(r.hat?.scale).toBeCloseTo(1.2);
  });

  it('no adjustment → def defaults untouched', () => {
    const r = resolveCosmetics({ hat: 'hat_fedora' });
    expect(r.hat?.angle).toBe(0);
    expect(r.hat?.scale).toBe(1);
  });

  it('adjustments for other hats are ignored', () => {
    const r = resolveCosmetics({ hat: 'hat_fedora' }, { hat_crown: { dAngle: 10, dScale: 0.9 } });
    expect(r.hat?.angle).toBe(0);
    expect(r.hat?.scale).toBe(1);
  });
});

describe('rainbowColorAt', () => {
  it('cycles: t=0 red, t=1000 ~green-ish, full period returns to start', () => {
    expect(rainbowColorAt(0)).toBe(rainbowColorAt(3000));
    expect(rainbowColorAt(0)).not.toBe(rainbowColorAt(1500));
  });

  it('always returns a 24-bit color', () => {
    for (const t of [0, 250, 999, 2999]) {
      const c = rainbowColorAt(t);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(0xffffff);
    }
  });
});
