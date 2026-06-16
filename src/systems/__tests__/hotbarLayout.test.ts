import { describe, it, expect } from 'vitest';
import { computeHotbarLayout, HOTBAR } from '../hotbarLayout';

describe('computeHotbarLayout', () => {
  it('lays out a few items with no scroll arrows', () => {
    const L = computeHotbarLayout({ gameWidth: 448, gameHeight: 970, ownedCount: 3, scrollOffset: 0 });
    expect(L.visibleCount).toBe(3);
    expect(L.showLeft).toBe(false);
    expect(L.showRight).toBe(false);
    expect(L.slotCxs).toHaveLength(3);
    expect(L.slotCxs[1] - L.slotCxs[0]).toBeCloseTo(HOTBAR.slotStride);
    expect(L.panelCy + L.panelH / 2).toBeCloseTo(970 - HOTBAR.bottomMargin);
    expect(L.headerCy).toBeLessThan(L.slotCy);
  });

  it('shows scroll arrows and clamps offset when items overflow', () => {
    const L = computeHotbarLayout({ gameWidth: 448, gameHeight: 970, ownedCount: 8, scrollOffset: 99 });
    expect(L.visibleCount).toBeLessThan(8);
    expect(L.showRight).toBe(false);
    expect(L.showLeft).toBe(true);
    expect(L.scrollOffset).toBe(8 - L.visibleCount);
    expect(L.leftBtnCx).toBeLessThan(L.slotCxs[0]);
    expect(L.rightBtnCx).toBeGreaterThan(L.slotCxs[L.slotCxs.length - 1]);
  });

  it('first page of an overflow shows only the right arrow', () => {
    const L = computeHotbarLayout({ gameWidth: 448, gameHeight: 970, ownedCount: 8, scrollOffset: 0 });
    expect(L.showLeft).toBe(false);
    expect(L.showRight).toBe(true);
  });

  it('handles an empty backpack', () => {
    const L = computeHotbarLayout({ gameWidth: 448, gameHeight: 970, ownedCount: 0, scrollOffset: 0 });
    expect(L.visibleCount).toBe(0);
    expect(L.slotCxs).toHaveLength(0);
    expect(L.showLeft).toBe(false);
    expect(L.showRight).toBe(false);
    // panel must stay wide enough for the "BACKPACK" title, never collapse to 2·padX
    expect(L.panelW).toBe(HOTBAR.minPanelW);
  });

  it('keeps a single-item tray centered (min width does not shift it)', () => {
    const L = computeHotbarLayout({ gameWidth: 448, gameHeight: 970, ownedCount: 1, scrollOffset: 0 });
    expect(L.slotCxs).toHaveLength(1);
    expect(L.slotCxs[0]).toBeCloseTo(L.panelCx);
  });
});
