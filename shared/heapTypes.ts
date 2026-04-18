// shared/heapTypes.ts

export interface Vertex {
  x: number;
  y: number;
}

export interface HeapParams {
  name: string;
  difficulty: number;      // 1.0..5.0 in 0.5 steps
  spawnRateMult: number;
  coinMult: number;
  scoreMult: number;
  isInfinite?: boolean;
}

export const DEFAULT_HEAP_PARAMS: HeapParams = {
  name: 'Unnamed Heap',
  difficulty: 1.0,
  spawnRateMult: 1.0,
  coinMult: 1.0,
  scoreMult: 1.0,
};

// ── Create ──────────────────────────────────────────────────────────────────

export interface CreateHeapRequest {
  vertices: Vertex[];
  params?: Partial<HeapParams>;
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
  params: HeapParams;
}

export interface ListHeapsResponse {
  heaps: HeapSummary[];
}

// ── Read (delta-aware) ───────────────────────────────────────────────────────

export type GetHeapResponse =
  | { changed: false; version: number }
  | { changed: true; version: number; baseId: string; liveZone: Vertex[]; params: HeapParams };

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
