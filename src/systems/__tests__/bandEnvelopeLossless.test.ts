// src/systems/__tests__/bandEnvelopeLossless.test.ts
//
// THE guarantee: reducing a heap's point set to its band envelope must not change
// a single rendered pixel. If this test fails, the whole design's "no visual
// change" promise is void — do not paper over it.

import { describe, it, expect } from 'vitest';
import { reconstructPolygonFromPoints } from '../HeapPolygonLoader';
import { verticesToEnvelope, envelopeToVertices } from '../../../shared/heapPolygon/bandEnvelope';
import type { Vertex } from '../../../shared/heapTypes';

/** Deterministic RNG so a failure is reproducible from the seed alone. */
function rng(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}

/** A heap-shaped point cloud: silhouette skeleton plus scattered placements and
 *  ghost points, mirroring how /place actually accumulates vertices. */
function heapPoints(seed: number, count: number): Vertex[] {
  const rnd = rng(seed);
  const topY = 47115, botY = 50000;
  const pts: Vertex[] = [];
  for (let y = topY; y <= botY; y += 20) {
    const t = (y - topY) / (botY - topY);
    const halfW = 60 + t * 380;
    pts.push({ x: 480 - halfW, y }, { x: 480 + halfW, y });
  }
  for (let i = 0; i < count; i++) {
    const y = topY + rnd() * (botY - topY);
    const t = (y - topY) / (botY - topY);
    const halfW = 60 + t * 380;
    pts.push({ x: Math.max(120, Math.min(840, 480 + (rnd() * 2 - 1) * halfW)), y });
    const a = pts[Math.floor(rnd() * pts.length)];
    pts.push({
      x: Math.max(120, Math.min(840, a.x + (rnd() * 2 - 1) * 40)),
      y: Math.max(topY, Math.min(botY, a.y + (rnd() * 2 - 1) * 40)),
    });
  }
  return pts;
}

describe('band envelope losslessness', () => {
  it('renders identically for 200 random heaps', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const pts = heapPoints(seed, 300);
      const direct = reconstructPolygonFromPoints(pts);
      const viaEnvelope = reconstructPolygonFromPoints(envelopeToVertices(verticesToEnvelope(pts)));
      expect(viaEnvelope, `seed ${seed}`).toEqual(direct);
    }
  });

  it('renders identically for degenerate inputs that a heap can reach', () => {
    const cases: Vertex[][] = [
      [],                                                   // empty
      [{ x: 400, y: 100 }],                                 // single point
      [{ x: 300, y: 100 }, { x: 500, y: 100 }],             // one band, two extents
      [{ x: 300, y: 100 }, { x: 500, y: 900 }],             // large gap, forward-fill
      [{ x: 300, y: 0 }, { x: 500, y: 19.999 }],            // band boundary
    ];
    for (const [i, pts] of cases.entries()) {
      const direct = reconstructPolygonFromPoints(pts);
      const viaEnvelope = reconstructPolygonFromPoints(envelopeToVertices(verticesToEnvelope(pts)));
      expect(viaEnvelope, `case ${i}`).toEqual(direct);
    }
  });

  it('draws nothing on either side for a band with no distinct extents', () => {
    // Two points sharing an x cannot round-trip to an equal ARRAY: the envelope
    // has discarded the point count, so it materialises one vertex and reconstruct
    // returns [] for fewer than two points. Both sides draw nothing, which is the
    // guarantee that matters. No emit rule can fix both this and the single-point
    // case — see the design doc §5.
    const pts: Vertex[] = [{ x: 400, y: 100 }, { x: 400, y: 105 }];
    const area = (p: Vertex[]): number =>
      p.length < 3 ? 0 : Math.abs(p.reduce((s, v, i) => {
        const w = p[(i + 1) % p.length];
        return s + v.x * w.y - w.x * v.y;
      }, 0) / 2);

    const direct = reconstructPolygonFromPoints(pts);
    const viaEnvelope = reconstructPolygonFromPoints(envelopeToVertices(verticesToEnvelope(pts)));
    expect(area(direct)).toBe(0);
    expect(area(viaEnvelope)).toBe(0);
  });

  it('bounds the point count by band coverage, not by placement count', () => {
    const few = envelopeToVertices(verticesToEnvelope(heapPoints(1, 100)));
    const many = envelopeToVertices(verticesToEnvelope(heapPoints(1, 5000)));
    expect(many.length).toBeLessThanOrEqual(2 * Math.ceil((50000 - 47115) / 20) + 2);
    expect(many.length).toBeLessThan(few.length * 3);
  });
});
