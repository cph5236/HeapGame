// src/scenes/tutorialExit.ts
//
// Where the tutorial hands off when it finishes or the player hits SKIP.
// Pure so the routing can be tested without booting Phaser.
//
// This mirrors the routing in MenuScene.startGame(). The two used to disagree:
// the tutorial always started GameScene, so a player with Infinite mode selected
// landed in the finite scene with an empty heap — a blank screen.
//
// The trap that caused it: BootScene seeds `heapPolygon` to `[]` at boot, and
// HeapSelectScene stores `[]` for Infinite mode — and an empty array is TRUTHY.
// Any "do we have a heap?" test written as `!!registry.get('heapPolygon')` is
// therefore always true and tells you nothing. So the polygon is not consulted
// here at all; `catalogReady` is the honest signal for "we know which heap the
// player is on", and it is checked first.

export type TutorialExit =
  | { kind: 'start'; scene: 'GameScene' | 'InfiniteGameScene' | 'MenuScene' }
  | { kind: 'waitForCatalog' };

export interface TutorialExitState {
  /**
   * `heapCatalogReady`. BootScene fetches the catalog in the BACKGROUND and
   * LoadingScene does not gate on it (it waits on game assets + remote config
   * only), so a first-time player can reach the tutorial — and hit SKIP — while
   * this is still false. Until it lands, `activeHeapId` is '' and `heapParams`
   * is DEFAULT_HEAP_PARAMS: placeholder state that must not be routed on.
   * BootScene always sets it true eventually, including on an empty catalog and
   * in its `.catch()`, so waiting cannot hang.
   */
  catalogReady: boolean;
  /** heapParams.isInfinite for the selected heap. */
  isInfinite: boolean;
  /** Whether an `activeHeapId` has been chosen. */
  hasActiveHeap: boolean;
}

export function resolveTutorialExit(state: TutorialExitState): TutorialExit {
  // Placeholder registry state — we do not yet know which heap, or even which
  // game mode, the player is on. Anything decided here would be a coin flip.
  if (!state.catalogReady) return { kind: 'waitForCatalog' };

  if (state.isInfinite)    return { kind: 'start', scene: 'InfiniteGameScene' };
  // An empty polygon is legitimate for a finite heap nobody has built on yet,
  // so the heap id — not the polygon — decides whether there is a run to enter.
  if (state.hasActiveHeap) return { kind: 'start', scene: 'GameScene' };
  // Catalog resolved with nothing usable (empty list, or the fetch failed and
  // BootScene's `.catch()` flipped the flag). There is no run to start.
  return { kind: 'start', scene: 'MenuScene' };
}
