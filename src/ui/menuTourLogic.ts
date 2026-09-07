// src/ui/menuTourLogic.ts
//
// Pure state logic for the main-menu coach-mark tour (testable without
// Phaser, same pattern as dailyDropLogic.ts / hudLogic.ts). CoachMarkTour
// owns the Phaser rendering; this module owns what steps exist and where
// the caption panel goes relative to the highlighted element.

export type MenuTourStepKind =
  | 'avatar' | 'heapPicker' | 'startRun' | 'upgradesStore' | 'playerName' | 'settings';

export interface MenuTourStep {
  kind: MenuTourStepKind;
  caption: string;
}

const STEP_AVATAR: MenuTourStep = {
  kind: 'avatar',
  caption: 'Tap your character to open the Wardrobe — dress them up with hats, skins, and more.',
};
const STEP_HEAP_PICKER: MenuTourStep = {
  kind: 'heapPicker',
  caption: 'Pick which heap to climb here — each one has its own difficulty and rewards.',
};
const STEP_START_RUN: MenuTourStep = {
  kind: 'startRun',
  caption: 'Tap START RUN to begin climbing!',
};
const STEP_UPGRADES_STORE: MenuTourStep = {
  kind: 'upgradesStore',
  caption: 'Spend your coins in UPGRADES to climb faster, or the STORE for cosmetics and consumables.',
};
const STEP_PLAYER_NAME: MenuTourStep = {
  kind: 'playerName',
  caption: 'Tap your name to change it — pick something memorable for the leaderboards!',
};
const STEP_SETTINGS: MenuTourStep = {
  kind: 'settings',
  caption: 'Open Settings anytime to adjust controls, audio, or replay this tour.',
};

/** Ordered step list for the tour. The player-name step only makes sense for
 *  a locally-named player — a GPGS-signed-in player's name comes from Play
 *  Games and can't be edited here, so it's skipped for them. */
export function buildMenuTourSteps(isGpgsSignedIn: boolean): MenuTourStep[] {
  const steps = [STEP_AVATAR, STEP_HEAP_PICKER, STEP_START_RUN, STEP_UPGRADES_STORE];
  if (!isGpgsSignedIn) steps.push(STEP_PLAYER_NAME);
  steps.push(STEP_SETTINGS);
  return steps;
}

/** Which half of the screen the caption panel should occupy, given the
 *  highlighted target's vertical center — always the half the target is
 *  NOT in, so the panel never covers the thing it's explaining. */
export function panelBand(targetCenterY: number, screenHeight: number): 'top' | 'bottom' {
  return targetCenterY < screenHeight / 2 ? 'bottom' : 'top';
}
