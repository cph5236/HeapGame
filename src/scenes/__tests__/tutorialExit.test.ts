/**
 * tutorialExit.test.ts — routing out of the tutorial (finish or SKIP).
 *
 * Regression: with Infinite mode selected, SKIP dropped the player into a blank
 * scene. TutorialScene.finish() always started GameScene, and its guard was a
 * bare truthiness check on the `heapPolygon` registry key — but HeapSelectScene
 * stores `[]` for Infinite mode, and an empty array is truthy. So the player
 * landed in the finite scene with no heap.
 */
import { describe, it, expect } from 'vitest';
import { resolveTutorialExit } from '../tutorialExit';

describe('resolveTutorialExit', () => {
  it('sends Infinite mode to InfiniteGameScene', () => {
    expect(resolveTutorialExit({
      isInfinite: true, hasPolygon: true, hasActiveHeap: true,
    })).toEqual({ kind: 'start', scene: 'InfiniteGameScene' });
  });

  it('sends a finite heap with a polygon to GameScene', () => {
    expect(resolveTutorialExit({
      isInfinite: false, hasPolygon: true, hasActiveHeap: true,
    })).toEqual({ kind: 'start', scene: 'GameScene' });
  });

  it('waits for the catalog when a heap is chosen but no polygon is loaded', () => {
    expect(resolveTutorialExit({
      isInfinite: false, hasPolygon: false, hasActiveHeap: true,
    })).toEqual({ kind: 'waitForCatalog' });
  });

  it('falls back to the menu when nothing is selected', () => {
    expect(resolveTutorialExit({
      isInfinite: false, hasPolygon: false, hasActiveHeap: false,
    })).toEqual({ kind: 'start', scene: 'MenuScene' });
  });

  it('never routes Infinite to GameScene for any combination of the other flags', () => {
    for (const hasPolygon of [true, false]) {
      for (const hasActiveHeap of [true, false]) {
        expect(resolveTutorialExit({ isInfinite: true, hasPolygon, hasActiveHeap }))
          .toEqual({ kind: 'start', scene: 'InfiniteGameScene' });
      }
    }
  });
});
