import { Vertex } from '../systems/HeapPolygon';

/** A polygon contour for one chunk band — used for server communication. */
export interface ChunkPolygon {
  bandTop: number;
  /** Ordered vertices forming a closed loop (left edge top→bottom, right edge bottom→top). */
  vertices: Vertex[];
}

/** Diff payload for streaming polygon updates to/from the server. */
export interface VertexDelta {
  bandTop: number;
  /** Full simplified polygon for this band (replace semantics). */
  vertices: Vertex[];
  /** Unix ms timestamp for ordering. */
  timestamp: number;
}

export type { Vertex };
