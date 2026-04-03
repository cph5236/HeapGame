import { CHUNK_BAND_HEIGHT, MOCK_HEAP_HEIGHT_PX } from '../constants';
import type { Vertex } from './HeapPolygon';
import { simplifyPolygon } from './HeapPolygon';
import type { HeapGenerator } from './HeapGenerator';

function interpolateAtY(a: Vertex, b: Vertex, targetY: number): Vertex {
  const t = (targetY - a.y) / (b.y - a.y);
  return { x: a.x + t * (b.x - a.x), y: targetY };
}

function clipToHalfPlane(
  polygon: Vertex[],
  inside: (v: Vertex) => boolean,
  intersect: (a: Vertex, b: Vertex) => Vertex,
): Vertex[] {
  if (polygon.length === 0) return [];
  const output: Vertex[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const aIn = inside(a);
    const bIn = inside(b);
    if (aIn) output.push(a);
    if (aIn !== bIn) output.push(intersect(a, b));
  }
  return output;
}

export function clipPolygonToBand(polygon: Vertex[], bandTop: number, bandBottom: number): Vertex[] {
  // Pass 1: discard vertices above the band (y < bandTop)
  let clipped = clipToHalfPlane(
    polygon,
    (v) => v.y >= bandTop,
    (a, b) => interpolateAtY(a, b, bandTop),
  );
  // Pass 2: discard vertices below the band (y > bandBottom)
  clipped = clipToHalfPlane(
    clipped,
    (v) => v.y <= bandBottom,
    (a, b) => interpolateAtY(a, b, bandBottom),
  );
  return clipped;
}

/**
 * Splits a flat polygon Vertex[] into CHUNK_BAND_HEIGHT bands and calls
 * generator.applyBandPolygon() for each band that has ≥3 vertices.
 *
 * The polygon must be structured as:
 *   left-edge vertices (Y ascending) then right-edge vertices (Y descending).
 * Filtering by Y while preserving array order yields a closed per-band polygon.
 */
export function applyPolygonToGenerator(polygon: Vertex[], generator: HeapGenerator): void {
  if (polygon.length === 0) return;

  let minY = MOCK_HEAP_HEIGHT_PX;
  let maxY = 0;
  for (const v of polygon) {
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }

  const firstBand = Math.floor(minY / CHUNK_BAND_HEIGHT) * CHUNK_BAND_HEIGHT;

  for (let bandTop = firstBand; bandTop <= maxY; bandTop += CHUNK_BAND_HEIGHT) {
    const bandBottom = bandTop + CHUNK_BAND_HEIGHT;
    const bandVertices = clipPolygonToBand(polygon, bandTop, bandBottom);
    if (bandVertices.length >= 3) {
      generator.applyBandPolygon(bandTop, bandVertices);
    }
  }
}

/**
 * Returns the Y of the polygon's summit (smallest Y = highest point in world).
 * Returns MOCK_HEAP_HEIGHT_PX if the polygon is empty (world floor fallback).
 * Uses an explicit loop to avoid spread-operator stack overflow on large arrays.
 */
export function polygonTopY(polygon: Vertex[]): number {
  if (polygon.length === 0) return MOCK_HEAP_HEIGHT_PX;
  let min = MOCK_HEAP_HEIGHT_PX;
  for (const v of polygon) {
    if (v.y < min) min = v.y;
  }
  return min;
}

/**
 * Reconstruct a proper boundary polygon from a flat list of placed points.
 *
 * The server stores placed points sorted by Y — not as a boundary polygon.
 * This function buckets points into CHUNK_BAND_HEIGHT bands, finds the leftmost
 * and rightmost X per band (with forward-fill for empty bands), and stitches
 * them into the left-edge-ascending / right-edge-descending format required by
 * applyPolygonToGenerator.
 *
 * Returns [] if fewer than 2 points are provided.
 */
export function reconstructPolygonFromPoints(points: Vertex[]): Vertex[] {
  if (points.length < 2) return [];

  const sorted = [...points].sort((a, b) => a.y - b.y);
  const minY = sorted[0].y;
  const maxY = sorted[sorted.length - 1].y;

  const firstBand = Math.floor(minY / CHUNK_BAND_HEIGHT) * CHUNK_BAND_HEIGHT;

  const leftEdge: Vertex[] = [];
  const rightEdge: Vertex[] = [];

  let lastMinX = sorted[0].x;
  let lastMaxX = sorted[0].x;

  for (let bandTop = firstBand; bandTop <= maxY; bandTop += CHUNK_BAND_HEIGHT) {
    const bandBottom = bandTop + CHUNK_BAND_HEIGHT;
    const bandMidY = bandTop + CHUNK_BAND_HEIGHT / 2;

    let bandMinX = Infinity;
    let bandMaxX = -Infinity;

    for (const v of sorted) {
      if (v.y >= bandTop && v.y < bandBottom) {
        if (v.x < bandMinX) bandMinX = v.x;
        if (v.x > bandMaxX) bandMaxX = v.x;
      }
    }

    if (bandMinX !== Infinity) {
      lastMinX = bandMinX;
      lastMaxX = bandMaxX;
    }
    // Forward-fill: use last known min/max if band is empty

    leftEdge.push({ x: lastMinX, y: bandMidY });
    rightEdge.push({ x: lastMaxX, y: bandMidY });
  }

  const simplifiedLeft = simplifyPolygon(leftEdge, 2);
  const simplifiedRight = simplifyPolygon(rightEdge, 2);

  // Stitch: left edge ascending Y, right edge descending Y
  return [...simplifiedLeft, ...[...simplifiedRight].reverse()];
}

/**
 * Finds the topmost surface Y within the X span [cx - width/2, cx + width/2].
 * Returns MOCK_HEAP_HEIGHT_PX if no vertices overlap (world floor fallback).
 */
export function findSurfaceYFromPolygon(cx: number, width: number, polygon: Vertex[]): number {
  const left = cx - width / 2;
  const right = cx + width / 2;
  let surfaceY = MOCK_HEAP_HEIGHT_PX;

  for (const v of polygon) {
    if (v.x >= left && v.x <= right && v.y < surfaceY) {
      surfaceY = v.y;
    }
  }
  return surfaceY;
}
