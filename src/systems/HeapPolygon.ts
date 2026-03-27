import { HeapEntry } from '../data/heapTypes';
import { OBJECT_DEFS } from '../data/heapObjectDefs';

/** Y-resolution of the silhouette scanline in world pixels. */
export const SCAN_STEP = 4;

/** Sliding-window size for edge smoothing (number of scanlines). Odd for symmetry. */
const SMOOTH_WINDOW = 7;

/** A single scanline row with left/right world-X boundaries. */
export interface ScanlineRow {
  y: number;
  leftX: number;
  rightX: number;
}

/** A 2D vertex in world space. */
export interface Vertex {
  x: number;
  y: number;
}

/**
 * Compute smoothed scanline rows for a set of heap entries within a vertical band.
 * Each row records the leftmost and rightmost X extent at that Y position.
 */
export function computeBandScanlines(
  entries: HeapEntry[],
  bandTop: number,
  bandBottom: number,
): ScanlineRow[] {
  // Pre-compute bounding rects
  const rects = entries.map(e => {
    const def = OBJECT_DEFS[e.keyid] ?? OBJECT_DEFS[0];
    return {
      left:   e.x - def.width  / 2,
      right:  e.x + def.width  / 2,
      top:    e.y - def.height / 2,
      bottom: e.y + def.height / 2,
    };
  });

  // Scanline: collect leftmost and rightmost X per row
  const rows: ScanlineRow[] = [];
  let lastLeft  = 480; // world center as fallback
  let lastRight = 480;

  for (let y = bandTop; y <= bandBottom; y += SCAN_STEP) {
    let minX =  Infinity;
    let maxX = -Infinity;
    for (const r of rects) {
      if (y >= r.top && y <= r.bottom) {
        if (r.left  < minX) minX = r.left;
        if (r.right > maxX) maxX = r.right;
      }
    }
    if (minX !== Infinity) {
      lastLeft  = minX;
      lastRight = maxX;
      rows.push({ y, leftX: minX, rightX: maxX });
    } else if (rows.length > 0) {
      // Forward-fill so the polygon stays continuous inside the band
      rows.push({ y, leftX: lastLeft, rightX: lastRight });
    }
  }

  if (rows.length < 2) return [];

  // Smooth left and right edges with a sliding-window average
  const smooth = (vals: number[]): number[] => {
    const half = Math.floor(SMOOTH_WINDOW / 2);
    return vals.map((_, i) => {
      let sum = 0, count = 0;
      for (let k = i - half; k <= i + half; k++) {
        if (k >= 0 && k < vals.length) { sum += vals[k]; count++; }
      }
      return sum / count;
    });
  };

  const leftSmooth  = smooth(rows.map(r => r.leftX));
  const rightSmooth = smooth(rows.map(r => r.rightX));

  for (let i = 0; i < rows.length; i++) {
    rows[i] = { y: rows[i].y, leftX: leftSmooth[i], rightX: rightSmooth[i] };
  }

  return rows;
}

/**
 * Convert scanline rows into a closed polygon (left edge top→bottom, right edge bottom→top).
 */
export function computeBandPolygon(rows: ScanlineRow[]): Vertex[] {
  if (rows.length < 2) return [];

  const points: Vertex[] = [];

  // Left edge: top → bottom
  for (let i = 0; i < rows.length; i++) {
    points.push({ x: rows[i].leftX, y: rows[i].y });
  }
  // Right edge: bottom → top
  for (let i = rows.length - 1; i >= 0; i--) {
    points.push({ x: rows[i].rightX, y: rows[i].y });
  }

  return points;
}

/**
 * Ramer-Douglas-Peucker polygon simplification.
 * Reduces vertex count while preserving shape within `epsilon` tolerance.
 */
export function simplifyPolygon(vertices: Vertex[], epsilon: number): Vertex[] {
  if (vertices.length <= 2) return vertices;

  // Find the point with the greatest distance from the line between first and last
  let maxDist = 0;
  let maxIdx  = 0;

  const start = vertices[0];
  const end   = vertices[vertices.length - 1];

  for (let i = 1; i < vertices.length - 1; i++) {
    const d = perpendicularDistance(vertices[i], start, end);
    if (d > maxDist) {
      maxDist = d;
      maxIdx  = i;
    }
  }

  if (maxDist > epsilon) {
    const left  = simplifyPolygon(vertices.slice(0, maxIdx + 1), epsilon);
    const right = simplifyPolygon(vertices.slice(maxIdx), epsilon);
    // Concatenate, removing duplicate point at the join
    return left.slice(0, -1).concat(right);
  }

  // All intermediate points are within epsilon — keep only endpoints
  return [start, end];
}

/** Perpendicular distance from point `p` to the line segment `a`→`b`. */
function perpendicularDistance(p: Vertex, a: Vertex, b: Vertex): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    // a and b are the same point
    return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
  }
  const cross = Math.abs(dx * (a.y - p.y) - dy * (a.x - p.x));
  return cross / Math.sqrt(lenSq);
}
