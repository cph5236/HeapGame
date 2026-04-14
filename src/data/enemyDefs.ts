// src/data/enemyDefs.ts
import type { EnemyKind } from '../entities/Enemy';

export interface EnemyDef {
  kind: EnemyKind;

  // Visuals / physics
  textureKey: string;     // Phaser texture key; falls back to 'enemy-fallback' if not loaded
  width: number;
  height: number;
  speed: number;          // px/sec horizontal patrol speed; 0 = stationary

  // Surface spawn eligibility
  spawnOnHeapSurface: boolean;  // spawn on roughly horizontal surfaces (angle < 30°)
  spawnOnHeapWall: boolean;     // spawn on steep surfaces (angle ≥ 30°)

  // Geographic spawn zone (world Y; lower Y = higher on heap)
  spawnStartY: number;    // enemy does not appear below this Y value
  spawnEndY: number;      // enemy does not appear above this Y value; -1 = no ceiling

  // Spawn chance linear ramp
  spawnChanceMin: number; // probability at spawnStartY (0–1)
  spawnChanceMax: number; // probability at spawnRampEndY (0–1)
  spawnRampEndY: number;  // Y at which spawnChanceMax is reached; -1 = ramp never arrives
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
    spawnStartY: 50000,
    spawnEndY: -1,
    spawnChanceMin: 0.15,
    spawnChanceMax: 0.35,
    spawnRampEndY: 10000,
  },
  ghost: {
    kind: 'ghost',
    textureKey: 'vulture-fly-left',
    width: 51,
    height: 43,
    speed: 320,
    spawnOnHeapSurface: true,
    spawnOnHeapWall: false,
    spawnStartY: 50000,
    spawnEndY: -1,
    spawnChanceMin: 0.25,
    spawnChanceMax: 0.5,
    spawnRampEndY: 5000,
  },
};
