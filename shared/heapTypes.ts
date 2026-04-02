// shared/heapTypes.ts

export interface Vertex {
  x: number;
  y: number;
}

// ── Create ──────────────────────────────────────────────────────────────────

export interface CreateHeapRequest {
  vertices: Vertex[];
}

export interface CreateHeapResponse {
  id: string;       // heap GUID — stable identity
  baseId: string;   // initial base snapshot GUID
  version: number;  // always 1 on create
  vertexCount: number;
}

// ── List ─────────────────────────────────────────────────────────────────────

export interface HeapSummary {
  id: string;
  version: number;
  createdAt: string;
}

export interface ListHeapsResponse {
  heaps: HeapSummary[];
}

// ── Read (delta-aware) ───────────────────────────────────────────────────────

export type GetHeapResponse =
  | { changed: false; version: number }
  | { changed: true; version: number; baseId: string; liveZone: Vertex[] };

// ── Place ─────────────────────────────────────────────────────────────────────

export interface PlaceRequest {
  x: number;
  y: number;
}

export interface PlaceResponse {
  accepted: boolean;
  version: number;
}

// ── Reset ─────────────────────────────────────────────────────────────────────

export interface ResetHeapResponse {
  id: string;
  version: number;
  previousVersion: number;
}

// ── Delete ────────────────────────────────────────────────────────────────────

export interface DeleteHeapResponse {
  deleted: boolean;
}
