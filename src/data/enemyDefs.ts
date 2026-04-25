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

  // Geographic spawn zone — fractions of worldHeight (0=summit, 1=floor)
  spawnStartFrac: number;   // enemy does not appear below this fraction; 1.0 = world floor
  spawnEndFrac: number;     // enemy does not appear above this fraction; -1 = no ceiling
  spawnChanceMin: number;   // probability at spawnStartFrac (0–1)
  spawnChanceMax: number;   // probability at spawnRampEndFrac (0–1)
  spawnRampEndFrac: number; // fraction at which spawnChanceMax is reached; -1 = ramp never arrives

  // Score tracking
  displayName: string;  // human-readable name shown in score breakdown
  scoreValue: number;   // score points awarded per kill
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
    spawnStartFrac: 1.0,
    spawnEndFrac: -1,
    spawnChanceMin: 0.15,
    spawnChanceMax: 0.45,
    spawnRampEndFrac: 0.6,
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
    spawnStartFrac: 0.9,
    spawnEndFrac: -1,
    spawnChanceMin: 0.10,
    spawnChanceMax: 0.35,
    spawnRampEndFrac: 0.1,
    displayName: 'VULTURE',
    scoreValue: 200,
  },
};
