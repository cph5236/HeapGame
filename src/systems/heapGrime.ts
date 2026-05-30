// src/systems/heapGrime.ts
//
// Procedural grime overlay for the heap texture: a seeded PRNG, a pure
// per-pixel colour grade, and a vertically-seamless grime tile. The grime is
// multiplied over the heap fill at chunk-bake time to add dirt cohesion; the
// grade lightly unifies the busy palette. Both are kept low-frequency — small
// noise is invisible against the busy trash texture.

/** Deterministic mulberry32 PRNG. Same seed → same sequence; values in [0, 1). */
export function makeGrimeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
