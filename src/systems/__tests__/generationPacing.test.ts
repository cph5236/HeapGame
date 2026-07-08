/**
 * Infinite-mode generation pacing: the expensive part of "generating a band" is
 * a synchronous canvas bake (HeapGenerator.flushWorkerResults →
 * HeapChunkRenderer.renderFromPolygon). Baking mid-jump / while moving fast
 * produces a very noticeable hitch. shouldBakeBands() defers that bake until the
 * player is grounded (hitch imperceptible), with a safety valve that force-bakes
 * if the baked "ceiling" gets close to the player while airborne — so a long
 * airborne stretch can never let the player reach un-baked heap.
 *
 * World Y grows downward (summit y=0, floor large-y); the player climbs upward
 * (y decreasing). bakedTopY is the highest baked band top (smallest world Y), so
 * the baked runway above the player is (playerY - bakedTopY).
 */
import { describe, it, expect } from 'vitest';
import { shouldBakeBands } from '../generationPacing';
import { GENERATION_BAKE_SAFETY_PX } from '../../constants';

const base = { onGround: false, hasPending: true, playerY: 100_000, bakedTopY: 90_000 };

describe('shouldBakeBands', () => {
  it('never bakes when there is nothing pending', () => {
    expect(shouldBakeBands({ ...base, hasPending: false, onGround: true })).toBe(false);
    expect(shouldBakeBands({ ...base, hasPending: false, onGround: false })).toBe(false);
  });

  it('bakes immediately when the player is grounded and work is pending', () => {
    expect(shouldBakeBands({ ...base, onGround: true })).toBe(true);
  });

  it('defers baking while airborne with plenty of baked runway ahead', () => {
    // runway = playerY - bakedTopY = 10_000, well beyond the safety margin.
    expect(shouldBakeBands({ ...base, onGround: false, playerY: 100_000, bakedTopY: 90_000 })).toBe(false);
  });

  it('force-bakes while airborne when the baked ceiling is within the safety margin', () => {
    // runway just under the margin → must bake even though airborne.
    const playerY = 100_000;
    const bakedTopY = playerY - (GENERATION_BAKE_SAFETY_PX - 1);
    expect(shouldBakeBands({ ...base, onGround: false, playerY, bakedTopY })).toBe(true);
  });

  it('does not force-bake exactly at the safety margin (strictly closer)', () => {
    const playerY = 100_000;
    const bakedTopY = playerY - GENERATION_BAKE_SAFETY_PX;
    expect(shouldBakeBands({ ...base, onGround: false, playerY, bakedTopY })).toBe(false);
  });

  it('force-bakes while airborne when nothing is baked yet (bakedTopY = +Infinity)', () => {
    expect(shouldBakeBands({ ...base, onGround: false, bakedTopY: Infinity })).toBe(true);
  });
});
