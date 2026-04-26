// src/data/enemyDefs.ts
import type { EnemyKind } from '../entities/Enemy';
import type { HeapEnemyParams } from '../../shared/heapTypes';

export interface EnemyDef {
  kind: EnemyKind;

  // Visuals / physics
  textureKey: string;
  width: number;
  height: number;
  speed: number;

  // Surface spawn eligibility
  spawnOnHeapSurface: boolean;
  spawnOnHeapWall: boolean;

  // Score tracking
  displayName: string;
  scoreValue: number;
}

export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  percher: {
    kind: 'percher',
    textureKey: 'rat',
    width: 32,
    height: 32,
    speed: 55,
    spawnOnHeapSurface: true,
    spawnOnHeapWall: false,
    displayName: 'RAT',
    scoreValue: 100,
  },
  ghost: {
    kind: 'ghost',
    textureKey: 'vulture-fly-left',
    width: 51,
    height: 43,
    speed: 320,
    spawnOnHeapSurface: true,
    spawnOnHeapWall: false,
    displayName: 'VULTURE',
    scoreValue: 200,
  },
};

// Fallback params used when no server-provided HeapEnemyParams are available
// (offline / infinite mode). Mirrors the sentinel row in heap_parameters.
export const DEFAULT_ENEMY_PARAMS: HeapEnemyParams = {
  percher: {
    spawnStartPxAboveFloor: 0,
    spawnEndPxAboveFloor: -1,
    spawnRampPxAboveFloor: 15000,
    spawnChanceMin: 0.15,
    spawnChanceMax: 0.45,
  },
  ghost: {
    spawnStartPxAboveFloor: 5000,
    spawnEndPxAboveFloor: -1,
    spawnRampPxAboveFloor: 20000,
    spawnChanceMin: 0.10,
    spawnChanceMax: 0.35,
  },
};
