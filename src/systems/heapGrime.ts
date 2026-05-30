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

/** Mix factor toward luma (0 = no change, 1 = greyscale). "Mild" grade. */
const GRADE_MIX = 0.22;
/** Warm tint added after the luma mix (R up, B down). */
const GRADE_WARM = { r: 10, g: 2, b: -8 };

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * Mild warm colour-grade for one RGB pixel: pull each channel partway toward
 * the pixel's luma (desaturate) then add a small warm tint. Pure + clamped.
 */
export function gradePixel(r: number, g: number, b: number): [number, number, number] {
  const L = 0.3 * r + 0.59 * g + 0.11 * b;
  const k = GRADE_MIX;
  return [
    clamp255(r * (1 - k) + L * k + GRADE_WARM.r),
    clamp255(g * (1 - k) + L * k + GRADE_WARM.g),
    clamp255(b * (1 - k) + L * k + GRADE_WARM.b),
  ];
}
