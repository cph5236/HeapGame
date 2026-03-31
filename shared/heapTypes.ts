export interface Vertex {
  x: number;
  y: number;
}

export type GetHeapResponse =
  | { changed: false; version: number }
  | { changed: true; version: number; baseHash: string; liveZone: Vertex[] };

export interface AppendHeapRequest {
  x: number;
  y: number;
}

export interface AppendHeapResponse {
  accepted: boolean;
  version: number;
}
