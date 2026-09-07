import { describe, it, expect } from 'vitest';
import { buildMenuTourSteps, panelBand } from '../menuTourLogic';

describe('buildMenuTourSteps', () => {
  it('includes the player-name step for a locally-named player', () => {
    const kinds = buildMenuTourSteps(false).map(s => s.kind);
    expect(kinds).toEqual(['avatar', 'heapPicker', 'startRun', 'upgradesStore', 'playerName', 'settings']);
  });

  it('skips the player-name step for a GPGS-signed-in player', () => {
    const kinds = buildMenuTourSteps(true).map(s => s.kind);
    expect(kinds).toEqual(['avatar', 'heapPicker', 'startRun', 'upgradesStore', 'settings']);
  });

  it('always ends on settings', () => {
    const withName = buildMenuTourSteps(false);
    const withoutName = buildMenuTourSteps(true);
    expect(withName[withName.length - 1].kind).toBe('settings');
    expect(withoutName[withoutName.length - 1].kind).toBe('settings');
  });
});

describe('panelBand', () => {
  it('places the panel in the bottom half when the target is in the top half', () => {
    expect(panelBand(100, 800)).toBe('bottom');
  });

  it('places the panel in the top half when the target is in the bottom half', () => {
    expect(panelBand(700, 800)).toBe('top');
  });

  it('treats exact center as not-top, so the panel goes to the top half', () => {
    expect(panelBand(400, 800)).toBe('top');
  });
});
