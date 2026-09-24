// src/scenes/menuStartRoute.ts
//
// What the main menu's heap picker shows and where START RUN goes. Pure so
// the first-launch flow can be tested without booting Phaser.
//
// A new player (tutorialDone false) lands on the menu with "Tutorial" shown as
// the selected heap. That is a DISPLAY override only: BootScene still loads the
// real easiest heap into the registry (activeHeapId / heapParams / heapPolygon)
// underneath it, so tutorialExit.ts can hand off to a run on it unchanged, and
// nothing that reads the registry ever sees a fake heap. Picking any heap in
// HeapSelectScene marks the tutorial done, which is what skipping it means.

import { formatDifficulty } from '../ui/DifficultyStars';

export type MenuStartRoute =
  | { scene: 'TutorialScene' }
  | { scene: 'InfiniteGameScene' }
  | { scene: 'GameScene'; useCheckpoint: boolean };

export interface MenuStartState {
  /** !getTutorialDone() — the Tutorial is the selected "heap". */
  tutorialPending: boolean;
  /** heapParams.isInfinite for the heap loaded in the registry. */
  isInfinite: boolean;
  /** The loaded heap has a placed checkpoint with spawns left. */
  hasCheckpoint: boolean;
}

export function resolveMenuStart(s: MenuStartState): MenuStartRoute {
  if (s.tutorialPending) return { scene: 'TutorialScene' };
  if (s.isInfinite)      return { scene: 'InfiniteGameScene' };
  return { scene: 'GameScene', useCheckpoint: s.hasCheckpoint };
}

export interface HeapPickerLabel {
  name: string;
  stars: string;
  /** Greyed-out placeholder text. */
  dim: boolean;
  /** Whether the trophy button beside the picker opens a leaderboard. */
  leaderboardEnabled: boolean;
}

export function heapPickerLabel(s: {
  tutorialPending: boolean; catalogReady: boolean; name: string; difficulty: number;
}): HeapPickerLabel {
  // The Tutorial has no leaderboard, and needs no catalog to be shown.
  if (s.tutorialPending) return { name: '▾ Tutorial', stars: '', dim: false, leaderboardEnabled: false };
  if (!s.catalogReady)   return { name: 'Heaps loading…', stars: '', dim: true, leaderboardEnabled: false };
  return { name: `▾ ${s.name}  `, stars: formatDifficulty(s.difficulty), dim: false, leaderboardEnabled: true };
}
