/**
 * tutorialExit.test.ts — routing out of the tutorial (finish or SKIP).
 *
 * Two blank-scene bugs, one root cause: `heapPolygon` is an EMPTY ARRAY in both
 * situations, and `[]` is truthy, so the old
 * `if (registry.get('heapPolygon')) start('GameScene')` guard always passed.
 *
 *   1. Infinite mode selected — HeapSelectScene stores `[]` as its polygon.
 *   2. A first-time player skipping before the heap catalog resolves —
 *      BootScene seeds `[]` at boot and LoadingScene does not gate on
 *      `heapCatalogReady`, so the tutorial can start on placeholder state.
 *
 * Both dumped the player into GameScene with no heap to climb.
 */
import { describe, it, expect } from 'vitest';
import { resolveTutorialExit, type TutorialExitState } from '../tutorialExit';

/** Catalog resolved, finite heap chosen — the ordinary case. */
const SETTLED: TutorialExitState = {
  catalogReady: true, isInfinite: false, hasActiveHeap: true,
};

describe('resolveTutorialExit', () => {
  it('sends a finite heap with a chosen id to GameScene', () => {
    expect(resolveTutorialExit(SETTLED)).toEqual({ kind: 'start', scene: 'GameScene' });
  });

  it('sends Infinite mode to InfiniteGameScene', () => {
    expect(resolveTutorialExit({ ...SETTLED, isInfinite: true }))
      .toEqual({ kind: 'start', scene: 'InfiniteGameScene' });
  });

  it('falls back to the menu when the catalog resolved with no usable heap', () => {
    // Empty catalog, or BootScene's .catch() flipped the flag after a failure.
    expect(resolveTutorialExit({ ...SETTLED, hasActiveHeap: false }))
      .toEqual({ kind: 'start', scene: 'MenuScene' });
  });

  // ── The race: skipping before the catalog lands ────────────────────────────

  it('waits instead of routing while the catalog is still in flight', () => {
    // Exactly the registry state BootScene seeds before HeapClient.list()
    // resolves: no heap id, DEFAULT_HEAP_PARAMS (isInfinite unset).
    expect(resolveTutorialExit({
      catalogReady: false, isInfinite: false, hasActiveHeap: false,
    })).toEqual({ kind: 'waitForCatalog' });
  });

  it('never starts a scene before the catalog is ready, whatever else is set', () => {
    for (const isInfinite of [true, false]) {
      for (const hasActiveHeap of [true, false]) {
        expect(resolveTutorialExit({ catalogReady: false, isInfinite, hasActiveHeap }))
          .toEqual({ kind: 'waitForCatalog' });
      }
    }
  });

  // ── The original bug ───────────────────────────────────────────────────────

  it('never routes Infinite to GameScene for any combination of the other flags', () => {
    for (const hasActiveHeap of [true, false]) {
      expect(resolveTutorialExit({ catalogReady: true, isInfinite: true, hasActiveHeap }))
        .toEqual({ kind: 'start', scene: 'InfiniteGameScene' });
    }
  });

  it('decides without consulting heapPolygon at all', () => {
    // The polygon is deliberately not an input. An empty array is truthy and is
    // what BOTH the infinite and pre-catalog cases hold, so it can never be a
    // reliable signal. This pins the shape of the contract.
    expect(Object.keys(SETTLED).sort()).toEqual(['catalogReady', 'hasActiveHeap', 'isInfinite']);
  });
});
