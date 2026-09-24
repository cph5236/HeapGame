import { describe, it, expect } from 'vitest';
import { buildMenuTourSteps, panelBand } from '../menuTourLogic';

describe('buildMenuTourSteps', () => {
  it('ends on the player-name step for a locally-named player', () => {
    const kinds = buildMenuTourSteps(false).map(s => s.kind);
    expect(kinds).toEqual(['avatar', 'heapPicker', 'startRun', 'upgradesStore', 'settings', 'playerName']);
  });

  it('skips the player-name step for a GPGS-signed-in player, ending on settings', () => {
    const kinds = buildMenuTourSteps(true).map(s => s.kind);
    expect(kinds).toEqual(['avatar', 'heapPicker', 'startRun', 'upgradesStore', 'settings']);
  });

  it('has the same steps whether or not the tutorial is pending', () => {
    expect(buildMenuTourSteps(false, true).map(s => s.kind))
      .toEqual(buildMenuTourSteps(false, false).map(s => s.kind));
  });

  it('explains the Tutorial heap on the picker and START RUN steps while the tutorial is pending', () => {
    const caption = (pending: boolean, kind: string) =>
      buildMenuTourSteps(false, pending).find(s => s.kind === kind)!.caption;
    expect(caption(true, 'heapPicker')).toMatch(/Tutorial/);
    expect(caption(true, 'heapPicker')).toMatch(/skip/i);
    expect(caption(true, 'startRun')).toMatch(/Tutorial/);
    expect(caption(false, 'heapPicker')).not.toMatch(/Tutorial/);
    expect(caption(false, 'startRun')).not.toMatch(/Tutorial/);
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
