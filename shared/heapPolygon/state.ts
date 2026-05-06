// shared/heapPolygon/state.ts
//
// Deterministic seeded PRNG (Mulberry32). Moved here so server + seed
// script can produce identical default polygons.

export class HeapState {
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  /** Returns a deterministic value in [0, 1) for a given input integer. */
  seededRandom(n: number): number {
    let t = (n ^ this.seed) + 0x6d2b79f5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
