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
