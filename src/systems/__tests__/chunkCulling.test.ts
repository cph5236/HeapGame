/**
 * Regression test for Crash_Reports.md P2 / Bug_Reports.md P2:
 * "Infinite heap laggy and crashes" + "Cannot read properties of null
 * (reading 'drawImage')".
 *
 * Root cause: InfiniteGameScene never culled off-screen heap chunks, so canvas
 * textures accumulated unbounded as the player climbed the 5,000,000px world →
 * memory pressure (lag) → allocation/GL-context failure → Phaser rendering an
 * Image whose CanvasTexture source is null → the null-drawImage crash.
 *
 * selectChunksToCull() is the pure decision that HeapChunkRenderer.cullChunks
 * uses: which band tops have scrolled far enough BELOW the camera to dispose.
 * (World Y grows downward: the summit is y=0, the floor is large-y, so a chunk
 * is "below" the camera when its bandTop is GREATER than the camera bottom.)
 */
import { describe, it, expect } from 'vitest';
import { selectChunksToCull } from '../chunkCulling';
import { ENEMY_CULL_DISTANCE } from '../../constants';

describe('selectChunksToCull', () => {
  it('culls band tops beyond the camera bottom + cull distance', () => {
    const camBottom = 10_000;
    const threshold = camBottom + ENEMY_CULL_DISTANCE; // 12_000
    const bandTops = [threshold + 1, threshold + 5000, camBottom];
    expect(selectChunksToCull(bandTops, camBottom).sort((a, b) => a - b)).toEqual([
      threshold + 1,
      threshold + 5000,
    ]);
  });

  it('keeps band tops that are on-screen or above (smaller Y)', () => {
    const camBottom = 10_000;
    // All of these are at/above the camera bottom → still visible/relevant, keep.
    const bandTops = [0, 5_000, camBottom, camBottom + ENEMY_CULL_DISTANCE];
    expect(selectChunksToCull(bandTops, camBottom)).toEqual([]);
  });

  it('does not cull a band exactly at the threshold (strict below)', () => {
    const camBottom = 0;
    const threshold = ENEMY_CULL_DISTANCE;
    expect(selectChunksToCull([threshold], camBottom)).toEqual([]);
    expect(selectChunksToCull([threshold + 1], camBottom)).toEqual([threshold + 1]);
  });

  it('returns an empty array when there are no chunks', () => {
    expect(selectChunksToCull([], 500)).toEqual([]);
  });
});
