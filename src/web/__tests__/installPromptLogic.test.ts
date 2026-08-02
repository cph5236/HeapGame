import { describe, it, expect } from 'vitest';
import {
  shouldShowInstallPrompt,
  shouldShowRails,
  MIN_RAIL_WIDTH_PX,
  MIN_RUNS_BEFORE_PROMPT,
  type InstallPromptState,
} from '../installPromptLogic';

const base: InstallPromptState = {
  runsFinished: MIN_RUNS_BEFORE_PROMPT,
  optedOut: false,
  shownThisSession: false,
  isNative: false,
  inIframe: false,
};

describe('shouldShowInstallPrompt', () => {
  it('shows once the player has finished a run and headed back', () => {
    expect(shouldShowInstallPrompt(base)).toBe(true);
  });

  // Regression: an earlier version counted MenuScene.create() calls, but
  // MenuScene is in RESIZE_SAFE_SCENES, so resizing the browser re-created it
  // and popped the prompt unprompted. Only finished runs may count.
  it('stays hidden before any run has been finished', () => {
    expect(shouldShowInstallPrompt({ ...base, runsFinished: 0 })).toBe(false);
  });

  it('still shows on later runs if it has not fired yet', () => {
    expect(shouldShowInstallPrompt({ ...base, runsFinished: 7 })).toBe(true);
  });

  it('never fires twice in one page load', () => {
    expect(shouldShowInstallPrompt({ ...base, shownThisSession: true })).toBe(false);
  });

  it('respects a persisted opt-out', () => {
    expect(shouldShowInstallPrompt({ ...base, optedOut: true })).toBe(false);
  });

  it('never fires in the Android shell — they already have the app', () => {
    expect(shouldShowInstallPrompt({ ...base, isNative: true })).toBe(false);
  });

  it('never fires inside an iframe — itch.io owns that page', () => {
    expect(shouldShowInstallPrompt({ ...base, inIframe: true })).toBe(false);
  });

  it('opt-out beats any number of finished runs', () => {
    expect(
      shouldShowInstallPrompt({ ...base, runsFinished: 5, optedOut: true }),
    ).toBe(false);
  });
});

describe('shouldShowRails', () => {
  const railBase = { railWidthPx: 400, isNative: false, inIframe: false };

  it('shows when the dead space is wide enough', () => {
    expect(shouldShowRails(railBase)).toBe(true);
  });

  it('shows exactly at the width floor', () => {
    expect(shouldShowRails({ ...railBase, railWidthPx: MIN_RAIL_WIDTH_PX })).toBe(true);
  });

  it('hides one pixel below the floor', () => {
    expect(shouldShowRails({ ...railBase, railWidthPx: MIN_RAIL_WIDTH_PX - 1 })).toBe(false);
  });

  it('hides when the game fills the viewport (phone in portrait)', () => {
    expect(shouldShowRails({ ...railBase, railWidthPx: 0 })).toBe(false);
  });

  it('hides in the Android shell regardless of width', () => {
    expect(shouldShowRails({ ...railBase, isNative: true })).toBe(false);
  });

  it('hides inside an iframe regardless of width', () => {
    expect(shouldShowRails({ ...railBase, inIframe: true })).toBe(false);
  });
});
