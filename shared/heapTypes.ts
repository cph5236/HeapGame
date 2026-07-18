// shared/heapTypes.ts

/**
 * Well-known row id for the infinite heap. The DB has no `isInfinite` column —
 * the client (src/data/infiniteCatalog.ts) merges `isInfinite: true` onto the
 * row with this id. The infinite heap can never be recorded as "beaten"
 * (markHeapBeaten only fires from story-mode placeBlock), so the server
 * rejects this id as a lock prerequisite (see validateLockTarget in
 * server/src/routes/heap.ts) to prevent a permanently unwinnable lock.
 */
export const INFINITE_HEAP_ID = 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF';

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
  worldHeight: number;     // px from Y=0 (summit) to Y=worldHeight (floor)
  isInfinite?: boolean;
  ghostPointCount: number;  // random extra points added per accepted placement
  baseItemSpawnRate: number;      // 0..1 chance a salvage pickup spawns per surface candidate
  positiveItemSpawnRate: number;  // weight for choosing a beneficial item when one spawns
  negativeItemSpawnRate: number;  // weight for choosing a hindering item when one spawns
  /** Heap id the player must beat before this heap unlocks; null/absent = unlocked. */
  lockedByHeapId?: string | null;
}

export const DEFAULT_HEAP_PARAMS: HeapParams = {
  name: 'Unnamed Heap',
  difficulty: 1.0,
  spawnRateMult: 1.0,
  coinMult: 1.0,
  scoreMult: 1.0,
  worldHeight: 50_000,
  ghostPointCount: 1,
  baseItemSpawnRate: 0.33,
  positiveItemSpawnRate: 0.15,  // 15% positive / 85% negative spawn mix by default
  negativeItemSpawnRate: 0.85,
};

// ── Enemy spawn params (served per-heap, replaces EnemyDef fraction fields) ──

export type EnemySpawnParams = {
  spawnStartPxAboveFloor: number;  // enemy does not appear below this many px above floor
  spawnEndPxAboveFloor: number;    // enemy does not appear above this height; -1 = no ceiling
  spawnRampPxAboveFloor: number;   // height at which spawnChanceMax is reached; -1 = flat at min
  spawnChanceMin: number;
  spawnChanceMax: number;
};

export type HeapEnemyParams = Record<string, EnemySpawnParams>;

// ── Create ──────────────────────────────────────────────────────────────────

export interface CreateHeapRequest {
  /** Optional. If absent, server generates a default polygon from seed + worldHeight. */
  vertices?: Vertex[];
  /** Optional. Used only when vertices is absent. Defaults to a random int. */
  seed?: number;
  /** Optional. Number of blocks to generate when building the default polygon. Defaults to 50. */
  numBlocks?: number;
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
  /** Current heap summit y in world coords (smaller = taller heap). */
  topY: number;
  params: HeapParams;
}

export interface ListHeapsResponse {
  heaps: HeapSummary[];
}

// ── Read (delta-aware) ───────────────────────────────────────────────────────

export type GetHeapResponse =
  | { changed: false; version: number }
  | { changed: true; version: number; baseId: string; liveZone: Vertex[]; params: HeapParams; enemyParams: HeapEnemyParams };

// ── Place ─────────────────────────────────────────────────────────────────────

export interface PlaceRequest {
  x: number;
  y: number;
  /** Optional player identity for attribution; auth token rides X-Player-Token. */
  playerGuid?: string;
}

export interface PlaceResponse {
  accepted: boolean;
  version: number;
  bonusCoins?: number;
}

// ── Reset ─────────────────────────────────────────────────────────────────────

export interface ResetHeapResponse {
  id: string;
  version: number;
  previousVersion: number;
}

// ── Update Params (no-vertices path) ─────────────────────────────────────────

/** All fields optional. worldHeight is rejected if present. */
export type UpdateHeapParamsRequest = Partial<Omit<HeapParams, 'worldHeight'>>;

export interface UpdateHeapParamsResponse {
  summary: HeapSummary;
}

// ── Delete ────────────────────────────────────────────────────────────────────

export interface DeleteHeapResponse {
  deleted: boolean;
}
