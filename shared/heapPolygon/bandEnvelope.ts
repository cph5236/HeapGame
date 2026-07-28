// The band envelope is the heap's authoritative shape: for each 20px horizontal
// band, the leftmost and rightmost x. This is exactly what the client renders
// (reconstructPolygonFromPoints buckets to the same resolution and keeps the same
// two extents per band), which is why simplifying to it is visually lossless.
//
// One predicate — "is this vertex the min-x or max-x of its band?" — serves as
// the placement containment test, the rollup simplification rule, and the render
// model.

import type { Vertex } from '../heapTypes';

/** Band height in world px. MUST equal the client's render resolution
 *  (CHUNK_BAND_HEIGHT / 25 = 500 / 25). The losslessness guarantee depends on it. */
export const BAND_SIZE_PX = 20;

export type BandRow = { band: number; minX: number; maxX: number };

/** band index -> horizontal extents. Sparse: absent bands are genuinely empty. */
export type BandEnvelope = Map<number, { minX: number; maxX: number }>;

export function bandOf(y: number): number {
  return Math.floor(y / BAND_SIZE_PX);
}

/** The y the client emits every vertex of a band at. */
export function bandMidY(band: number): number {
  return band * BAND_SIZE_PX + BAND_SIZE_PX / 2;
}

export function verticesToEnvelope(vertices: Vertex[]): BandEnvelope {
  const env: BandEnvelope = new Map();
  for (const v of vertices) {
    const band = bandOf(v.y);
    const cur = env.get(band);
    if (!cur) {
      env.set(band, { minX: v.x, maxX: v.x });
    } else {
      if (v.x < cur.minX) cur.minX = v.x;
      if (v.x > cur.maxX) cur.maxX = v.x;
    }
  }
  return env;
}

/**
 * Materialise an envelope back into the point set the renderer consumes.
 * Emits at band-mid-y, ascending by band, one vertex when the extents are equal
 * so the client's single-point-band rule still triggers, and nothing at all for
 * absent bands so the client's forward-fill still runs. Feed the output to
 * reconstructPolygonFromPoints — do not build edges from it directly.
 */
export function envelopeToVertices(env: BandEnvelope): Vertex[] {
  const out: Vertex[] = [];
  for (const band of [...env.keys()].sort((a, b) => a - b)) {
    const { minX, maxX } = env.get(band)!;
    const y = bandMidY(band);
    out.push({ x: minX, y });
    if (maxX !== minX) out.push({ x: maxX, y });
  }
  return out;
}

/**
 * The containment test. True when (x, y) would widen its band — i.e. the vertex
 * is visible. A point at or inside the extents cannot change the silhouette, so
 * storing it would cost CPU and egress forever and render nothing.
 */
export function extendsEnvelope(env: BandEnvelope, x: number, y: number): boolean {
  const cur = env.get(bandOf(y));
  if (!cur) return true;
  return x < cur.minX || x > cur.maxX;
}

/** Apply rows to an envelope with MIN/MAX. Conflict-free and idempotent. */
export function mergeBands(env: BandEnvelope, rows: BandRow[]): BandEnvelope {
  const out: BandEnvelope = new Map(env);
  for (const r of rows) {
    const cur = out.get(r.band);
    if (!cur) {
      out.set(r.band, { minX: r.minX, maxX: r.maxX });
    } else {
      out.set(r.band, {
        minX: Math.min(cur.minX, r.minX),
        maxX: Math.max(cur.maxX, r.maxX),
      });
    }
  }
  return out;
}

/**
 * Seed the unknown side of a brand-new band by interpolating between the
 * nearest bands above and below that have two distinct extents.
 *
 * A placement into an empty band knows one x, so the band is stored with
 * minX === maxX. The renderer then assigns that lone point to whichever edge it
 * is nearer and forward-fills the other from the previous band — which, when the
 * previous band's extents are far away, yanks one edge across the heap and holds
 * it there until a two-extent band snaps it back. That is the sawtooth.
 * Interpolating gives the unknown side a value that belongs to this y instead of
 * inheriting one that belongs to a different y.
 *
 * Deliberately requires a neighbour on BOTH sides — the band must be genuinely
 * *between* two known ones. A new band above the summit has nothing above it, and
 * seeding it from the band below alone would make every new summit band as wide
 * as the one beneath it, growing the heap as a flat-topped column instead of a
 * taper.
 *
 * Single-extent neighbours are skipped as seed sources: their own unknown side is
 * a forward-filled guess, and interpolating from a guess propagates it.
 *
 * Returns null when there is no pair to interpolate between, meaning "store the
 * point as-is".
 */
export function interpolateBandSeed(
  env: BandEnvelope,
  band: number,
): { minX: number; maxX: number } | null {
  let above: number | null = null; // nearest lower band index (smaller y, up-screen)
  let below: number | null = null; // nearest higher band index
  for (const [b, e] of env) {
    if (e.minX === e.maxX || b === band) continue;
    if (b < band) { if (above === null || b > above) above = b; }
    else if (below === null || b < below) below = b;
  }
  if (above === null || below === null) return null;
  const a = env.get(above)!;
  const z = env.get(below)!;
  const t = (band - above) / (below - above);
  return {
    minX: a.minX + (z.minX - a.minX) * t,
    maxX: a.maxX + (z.maxX - a.maxX) * t,
  };
}

/**
 * Widen each row that lands in a currently-empty band with its interpolated
 * seed, so the band records a plausible opposite side instead of a single point.
 * The placed x always wins on the side it falls outside — seeding fills in the
 * unknown side, it never overrides observed geometry. Rows for bands that
 * already exist are returned untouched: those have real extents already.
 */
export function seedNewBands(rows: BandRow[], existing: BandEnvelope): BandRow[] {
  return rows.map((r) => {
    // Only a row that is genuinely one point needs a side invented. If several
    // candidates landed in the same new band they already give it two extents,
    // and widening that further would fabricate geometry past what was observed.
    if (existing.has(r.band) || r.minX !== r.maxX) return r;
    const seed = interpolateBandSeed(existing, r.band);
    if (!seed) return r;
    return {
      band: r.band,
      minX: Math.min(r.minX, seed.minX),
      maxX: Math.max(r.maxX, seed.maxX),
    };
  });
}

export function envelopeToRows(env: BandEnvelope): BandRow[] {
  return [...env.keys()]
    .sort((a, b) => a - b)
    .map((band) => ({ band, ...env.get(band)! }));
}

/** Flat numeric triples — [band, minX, maxX, ...]. Object keys would roughly
 *  triple a payload whose size this work exists to reduce. */
export function bandsToWire(rows: BandRow[]): number[] {
  const out: number[] = [];
  for (const r of rows) out.push(r.band, r.minX, r.maxX);
  return out;
}

export function wireToBands(wire: number[]): BandRow[] {
  const out: BandRow[] = [];
  for (let i = 0; i + 2 < wire.length; i += 3) {
    out.push({ band: wire[i], minX: wire[i + 1], maxX: wire[i + 2] });
  }
  return out;
}
