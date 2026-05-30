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

/**
 * Build a vertically-seamless grime tile (white-based, for `multiply`):
 * low-frequency dark pockets + gentle vertical dirt streaks. Features that
 * cross the top/bottom edge are drawn wrapped, so the tile repeats in Y with
 * no seam — required because the renderer tiles it by world-Y across bands.
 * No high-frequency noise (it vanishes against the busy heap texture).
 */
export function createGrimeTile(width: number, height: number, seed: number): HTMLCanvasElement {
  const rnd = makeGrimeRng(seed);
  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = height;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Low-frequency dark pockets (value variation / fake lumps). Draw each at y
  // and at y±height so any pocket near an edge wraps seamlessly.
  const POCKETS = 12;
  for (let i = 0; i < POCKETS; i++) {
    const x = rnd() * width;
    const y = rnd() * height;
    const r = 140 + rnd() * 220;
    const a = 0.16 + rnd() * 0.14; // medium
    for (const dy of [-height, 0, height]) {
      const grad = ctx.createRadialGradient(x, y + dy, 0, x, y + dy, r);
      grad.addColorStop(0, `rgba(20,14,8,${a})`);
      grad.addColorStop(1, 'rgba(20,14,8,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y + dy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Gentle vertical dirt streaks, wrapped in Y the same way.
  const STREAKS = 30;
  for (let i = 0; i < STREAKS; i++) {
    const x = rnd() * width;
    const len = 90 + rnd() * 260;
    const y = rnd() * height;
    const a = 0.05 + rnd() * 0.09;
    const w = 2 + rnd() * 6;
    for (const dy of [-height, 0, height]) {
      const grad = ctx.createLinearGradient(x, y + dy, x, y + dy + len);
      grad.addColorStop(0, 'rgba(18,12,6,0)');
      grad.addColorStop(0.25, `rgba(18,12,6,${a})`);
      grad.addColorStop(1, 'rgba(18,12,6,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y + dy, w, len);
    }
  }

  return cv;
}

/**
 * Apply the mild warm grade in-place to the opaque pixels of a canvas region.
 * Skips fully-transparent pixels so it only touches the drawn heap fill
 * (putImageData ignores clipping, so the alpha check is what scopes it).
 */
export function applyColourGrade(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const img = ctx.getImageData(x, y, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const [nr, ng, nb] = gradePixel(d[i], d[i + 1], d[i + 2]);
    d[i] = nr; d[i + 1] = ng; d[i + 2] = nb;
  }
  ctx.putImageData(img, x, y);
}
