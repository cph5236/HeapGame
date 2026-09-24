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

// First-launch variants: a new player's menu has the Tutorial selected in the
// heap picker (see menuStartRoute.ts), so these two steps explain that instead.
const STEP_HEAP_PICKER_TUTORIAL: MenuTourStep = {
  kind: 'heapPicker',
  caption: 'You\'re set to the Tutorial. Pick a different heap here to skip it and start climbing.',
};
const STEP_START_RUN_TUTORIAL: MenuTourStep = {
  kind: 'startRun',
  caption: 'Tap START RUN to play the Tutorial and learn the ropes!',
};
const STEP_UPGRADES_STORE: MenuTourStep = {
  kind: 'upgradesStore',
  caption: 'Spend your Scrap in UPGRADES to climb faster, or the STORE for placeables and consumables.',
};
const STEP_PLAYER_NAME: MenuTourStep = {
  kind: 'playerName',
  caption: 'Tap your name anytime to change it. Let\'s pick one for the leaderboards now!',
};
const STEP_SETTINGS: MenuTourStep = {
  kind: 'settings',
  caption: 'Settings has your controls and audio. The ? beside it replays this tour anytime.',
};

/** Ordered step list for the tour. The player-name step only makes sense for
 *  a locally-named player — a GPGS-signed-in player's name comes from Play
 *  Games and can't be edited here, so it's skipped for them. When present it
 *  is LAST, because finishing the first-run tour opens the name editor.
 *  `tutorialPending` swaps in the captions for a menu with the Tutorial
 *  selected. */
export function buildMenuTourSteps(isGpgsSignedIn: boolean, tutorialPending = false): MenuTourStep[] {
  const steps = [
    STEP_AVATAR,
    tutorialPending ? STEP_HEAP_PICKER_TUTORIAL : STEP_HEAP_PICKER,
    tutorialPending ? STEP_START_RUN_TUTORIAL : STEP_START_RUN,
    STEP_UPGRADES_STORE,
    STEP_SETTINGS,
  ];
  if (!isGpgsSignedIn) steps.push(STEP_PLAYER_NAME);
  return steps;
}

/** Which half of the screen the caption panel should occupy, given the
 *  highlighted target's vertical center — always the half the target is
 *  NOT in, so the panel never covers the thing it's explaining. */
export function panelBand(targetCenterY: number, screenHeight: number): 'top' | 'bottom' {
  return targetCenterY < screenHeight / 2 ? 'bottom' : 'top';
}
