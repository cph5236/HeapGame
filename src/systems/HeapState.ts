/**
 * HeapState represents the global shared state of the heap.
 * In production this would come from a backend. For the prototype
 * it is a local mock with configurable height and seed.
 */
export class HeapState {
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  /** Returns a deterministic value in [0, 1) for a given input integer. */
  seededRandom(n: number): number {
    // Mulberry32 — fast, good distribution, fully deterministic
    let t = (n ^ this.seed) + 0x6d2b79f5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
