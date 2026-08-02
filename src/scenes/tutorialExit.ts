// src/scenes/tutorialExit.ts
//
// Where the tutorial hands off when it finishes or the player hits SKIP.
// Pure so the routing can be tested without booting Phaser.
//
// This mirrors the routing in MenuScene.startGame(). The two used to disagree:
// the tutorial always started GameScene, so a player with Infinite mode selected
// landed in the finite scene with an empty heap — a blank screen.

export type TutorialExit =
  | { kind: 'start'; scene: 'GameScene' | 'InfiniteGameScene' | 'MenuScene' }
  | { kind: 'waitForCatalog' };

export interface TutorialExitState {
  /** heapParams.isInfinite for the selected heap. */
  isInfinite: boolean;
  /**
   * Whether the `heapPolygon` registry key holds anything at all — matching the
   * original truthiness check. NOTE: an *empty array* counts as present, which
   * is correct for a finite heap nobody has built on yet, but is also exactly
   * what HeapSelectScene stores for Infinite mode. That is why `isInfinite` has
   * to be tested first rather than relying on this flag.
   */
  hasPolygon: boolean;
  /** Whether an `activeHeapId` has been chosen. */
  hasActiveHeap: boolean;
}

export function resolveTutorialExit(state: TutorialExitState): TutorialExit {
  if (state.isInfinite)    return { kind: 'start', scene: 'InfiniteGameScene' };
  if (state.hasPolygon)    return { kind: 'start', scene: 'GameScene' };
  if (state.hasActiveHeap) return { kind: 'waitForCatalog' };
  return { kind: 'start', scene: 'MenuScene' };
}
