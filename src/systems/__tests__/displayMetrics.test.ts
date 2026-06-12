import { describe, it, expect, afterEach, vi } from 'vitest';
import { getDprCap, DPR_CAP, logicalWidth, logicalHeight, applyCameraZoom, setupUiCamera } from '../displayMetrics';

function stubWindow(dpr: number, search = ''): void {
  vi.stubGlobal('window', {
    devicePixelRatio: dpr,
    location: { search },
  } as unknown as Window);
}

describe('displayMetrics', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('DPR_CAP is 2.5', () => {
    expect(DPR_CAP).toBe(2.5);
  });

  it('caps a high devicePixelRatio at 2.5', () => {
    stubWindow(3.5);
    expect(getDprCap()).toBe(2.5);
  });

  it('returns the cap when devicePixelRatio equals it exactly', () => {
    stubWindow(2.5);
    expect(getDprCap()).toBe(2.5);
  });

  it('returns the real ratio below the cap', () => {
    stubWindow(2);
    expect(getDprCap()).toBe(2);
  });

  it('returns 1 under the scene-preview (?dev) tooling regardless of ratio', () => {
    stubWindow(3, '?dev');
    expect(getDprCap()).toBe(1);
  });

  it('falls back to 1 when devicePixelRatio is missing', () => {
    stubWindow(undefined as unknown as number);
    expect(getDprCap()).toBe(1);
  });

  it('derives logical width/height by dividing scale size by the cap', () => {
    stubWindow(2);
    const scene = { scale: { width: 822, height: 1600 } } as unknown as Phaser.Scene;
    expect(logicalWidth(scene)).toBe(411);
    expect(logicalHeight(scene)).toBe(800);
  });

  it('applyCameraZoom sets the main camera zoom to the capped DPR', () => {
    stubWindow(2);
    const setZoom = vi.fn();
    const scene = { cameras: { main: { setZoom } } } as unknown as Phaser.Scene;
    applyCameraZoom(scene);
    expect(setZoom).toHaveBeenCalledWith(2);
  });

  it('setupUiCamera zooms AND centres on the logical origin', () => {
    stubWindow(2);
    const setZoom = vi.fn();
    const centerOn = vi.fn();
    const scene = {
      scale: { width: 822, height: 1600 },
      cameras: { main: { setZoom, centerOn } },
    } as unknown as Phaser.Scene;
    setupUiCamera(scene);
    expect(setZoom).toHaveBeenCalledWith(2);
    // logical 822/2 = 411 wide, 1600/2 = 800 tall → centre (205.5, 400)
    expect(centerOn).toHaveBeenCalledWith(205.5, 400);
  });
});
