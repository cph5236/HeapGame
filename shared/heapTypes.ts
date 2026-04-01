export interface Vertex {
  x: number;
  y: number;
}

export type GetHeapResponse =
  | { changed: false; version: number }
  | { changed: true; version: number; baseHash: string; liveZone: Vertex[] };

export interface GetHashesResponse {
  hashes: string[];
}

export interface AppendHeapRequest {
  hash: string;
  x: number;
  y: number;
}

export interface AppendHeapResponse {
  accepted: boolean;
  version: number;
}

export interface SeedHeapRequest {
  vertices: Vertex[];
  overwriteHeap?: boolean;
}

export interface SeedHeapResponse {
  seeded: boolean;
  version: number;
  hash: string;
  vertexCount: number;
}
