import { describe, it, expect } from 'vitest';
import { clipPolygonToBand, reconstructPolygonFromPoints } from '../HeapPolygonLoader';

// Vertex type: { x: number; y: number }
// Y increases downward (Phaser world coords).
// bandTop < bandBottom.

describe('clipPolygonToBand', () => {
  it('clips a tall rectangle to the band, inserting vertices at band boundaries', () => {
    // Rectangle from y=0 to y=1000, x=100-200. Band [500, 1000].
    // Expected: bottom half of the rectangle with vertices at exactly y=500 and y=1000.
    const poly = [
      { x: 100, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 1000 },
      { x: 100, y: 1000 },
    ];
    const result = clipPolygonToBand(poly, 500, 1000);

    expect(result.length).toBeGreaterThanOrEqual(3);
    const ys = result.map(v => v.y);
    expect(Math.min(...ys)).toBeCloseTo(500);
    expect(Math.max(...ys)).toBeCloseTo(1000);
  });

  it('returns polygon unchanged when fully inside band', () => {
    const poly = [
      { x: 0, y: 600 },
      { x: 100, y: 600 },
      { x: 100, y: 900 },
      { x: 0, y: 900 },
    ];
    const result = clipPolygonToBand(poly, 500, 1000);

    expect(result.length).toBe(4);
    result.forEach(v => {
      expect(v.y).toBeGreaterThanOrEqual(500);
      expect(v.y).toBeLessThanOrEqual(1000);
    });
  });

  it('returns empty array when polygon is entirely above band', () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 400 },
      { x: 0, y: 400 },
    ];
    const result = clipPolygonToBand(poly, 500, 1000);
    expect(result).toHaveLength(0);
  });

  it('returns empty array when polygon is entirely below band', () => {
    const poly = [
      { x: 0, y: 1100 },
      { x: 100, y: 1100 },
      { x: 100, y: 1500 },
      { x: 0, y: 1500 },
    ];
    const result = clipPolygonToBand(poly, 500, 1000);
    expect(result).toHaveLength(0);
  });

  it('clips a partial overlap, producing boundary vertices at bandTop', () => {
    // Rectangle from y=200 to y=700, x=100-200. Band [500, 1000].
    // Overlap is y=500..700. Boundary vertex should appear at y=500.
    const poly = [
      { x: 100, y: 200 },
      { x: 200, y: 200 },
      { x: 200, y: 700 },
      { x: 100, y: 700 },
    ];
    const result = clipPolygonToBand(poly, 500, 1000);

    expect(result.length).toBeGreaterThanOrEqual(3);
    const ys = result.map(v => v.y);
    expect(Math.min(...ys)).toBeCloseTo(500);
    expect(Math.max(...ys)).toBeCloseTo(700);
  });

  it('interpolates X correctly at the band boundary', () => {
    // Diagonal edge from (0, 400) to (100, 600). Band [500, 1000].
    // At y=500: t=(500-400)/(600-400)=0.5, x=0+0.5*100=50
    // Triangle closes implicitly: (0,600) → (0,400) is the final edge.
    // Only the edge (0,400)→(100,600) crosses y=500, yielding x=50 by interpolation.
    const poly = [
      { x: 0, y: 400 },
      { x: 100, y: 600 },
      { x: 0, y: 600 },
    ];
    const result = clipPolygonToBand(poly, 500, 1000);

    const boundaryVertex = result.find(v => Math.abs(v.y - 500) < 0.01);
    expect(boundaryVertex).toBeDefined();
    expect(boundaryVertex!.x).toBeCloseTo(50);
  });

  it('returns empty array for an empty polygon', () => {
    expect(clipPolygonToBand([], 500, 1000)).toHaveLength(0);
  });

  it('interpolates X correctly at the bottom band boundary', () => {
    // Diamond-ish shape: top at (50,400), right at (100,500), bottom at (50,600), left at (0,500).
    // Band [400, 500]. The edges crossing y=500 (bottom boundary) are:
    //   (100,500)→(50,600): A is on boundary (in), B is below (out) → insert at y=500 → (100,500) itself
    //   (50,600)→(0,500):   A is below (out), B is on boundary (in) → insert at y=500 → (0,500) itself
    // So the clipped polygon should have all four vertices ≤ y=500 with min y ≈ 400 and max y ≈ 500.
    const poly = [
      { x: 50, y: 400 },
      { x: 100, y: 500 },
      { x: 50, y: 600 },
      { x: 0, y: 500 },
    ];
    const result = clipPolygonToBand(poly, 400, 500);

    expect(result.length).toBeGreaterThanOrEqual(3);
    const ys = result.map(v => v.y);
    expect(Math.min(...ys)).toBeCloseTo(400);
    expect(Math.max(...ys)).toBeCloseTo(500);
    result.forEach(v => expect(v.y).toBeLessThanOrEqual(500 + 0.01));
  });
});

describe('reconstructPolygonFromPoints', () => {
  it('returns [] for empty input', () => {
    expect(reconstructPolygonFromPoints([])).toHaveLength(0);
  });

  it('returns [] for a single point', () => {
    expect(reconstructPolygonFromPoints([{ x: 100, y: 500 }])).toHaveLength(0);
  });

  it('produces a polygon with left-edge Y ascending then right-edge Y descending', () => {
    // Two bands: band 0 (y=0..500), band 1 (y=500..1000)
    // Band 0: points at x=200,y=100 and x=700,y=300 → minX=200, maxX=700
    // Band 1: points at x=150,y=600 and x=750,y=800 → minX=150, maxX=750
    const points = [
      { x: 200, y: 100 },
      { x: 700, y: 300 },
      { x: 150, y: 600 },
      { x: 750, y: 800 },
    ];
    const result = reconstructPolygonFromPoints(points);
    expect(result.length).toBeGreaterThanOrEqual(4);

    // Left edge: first half, Y must be ascending
    const half = Math.floor(result.length / 2);
    const leftEdge = result.slice(0, half);
    const rightEdge = result.slice(half);

    for (let i = 1; i < leftEdge.length; i++) {
      expect(leftEdge[i].y).toBeGreaterThanOrEqual(leftEdge[i - 1].y);
    }
    // Right edge: Y must be descending
    for (let i = 1; i < rightEdge.length; i++) {
      expect(rightEdge[i].y).toBeLessThanOrEqual(rightEdge[i - 1].y);
    }
  });

  it('preserves a concave left side', () => {
    // Band 0 (y=0..500): left point jutting out at x=50
    // Band 1 (y=500..1000): left point at x=200 (narrower)
    // The left edge should contain a vertex with x ≈ 50
    const points = [
      { x: 50, y: 200 },   // leftmost in band 0
      { x: 700, y: 300 },  // rightmost in band 0
      { x: 200, y: 600 },  // left in band 1
      { x: 750, y: 800 },  // right in band 1
    ];
    const result = reconstructPolygonFromPoints(points);
    const half = Math.ceil(result.length / 2);
    const leftEdge = result.slice(0, half);
    // Some left-edge vertex should be near x=50
    const hasJut = leftEdge.some(v => v.x <= 60);
    expect(hasJut).toBe(true);
  });

  it('forward-fills an empty band from the band above', () => {
    // Band 0 (y=0..500): points at x=200,y=100 and x=700,y=300
    // Band 1 (y=500..1000): no points
    // Band 2 (y=1000..1500): points at x=250,y=1100 and x=680,y=1200
    // Band 1 should inherit minX=200, maxX=700 from band 0
    const points = [
      { x: 200, y: 100 },
      { x: 700, y: 300 },
      { x: 250, y: 1100 },
      { x: 680, y: 1200 },
    ];
    const result = reconstructPolygonFromPoints(points);
    // Should have entries for all 3 bands → at least 6 vertices total (3 left + 3 right)
    expect(result.length).toBeGreaterThanOrEqual(6);
  });

  it('output left-edge x values respect min-X of each band', () => {
    // Band 0 (y=0..500): x=300,y=200 and x=600,y=400 → minX=300
    // Band 1 (y=500..1000): x=100,y=700 and x=800,y=900 → minX=100
    const points = [
      { x: 300, y: 200 },
      { x: 600, y: 400 },
      { x: 100, y: 700 },
      { x: 800, y: 900 },
    ];
    const result = reconstructPolygonFromPoints(points);
    const half = Math.ceil(result.length / 2);
    const leftEdge = result.slice(0, half);
    // Minimum x across left edge should be ≤ 100 (the minX of band 1)
    const minLeftX = Math.min(...leftEdge.map(v => v.x));
    expect(minLeftX).toBeLessThanOrEqual(110); // small tolerance for simplification
  });
});
