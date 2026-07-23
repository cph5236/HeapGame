// shared/enemyDefs.ts
import type { HeapEnemyParams } from './heapTypes';

export type EnemyKind = 'percher' | 'ghost' | 'jumper';

/**
 * Physics body bounds in unscaled texture-frame pixels. Used to give an
 * enemy a tighter collision box than its display rect — and (for animated
 * enemies like the rat) to swap between per-state boxes (walking vs idle).
 */
export interface BodyBox {
  width:    number;
  height:   number;
  /** Top-left offset of the body within the unscaled texture frame. */
  offsetX:  number;
  offsetY:  number;
}

export interface EnemyDef {
  kind: EnemyKind;

  // Visuals / physics
  textureKey: string;
  width: number;
  height: number;
  speed: number;

  /** Per-state body boxes. If omitted, body falls back to width × height. */
  bodyWalking?: BodyBox;
  bodyIdle?:    BodyBox;
  /** Extended-clamp body box for the jumper attack state. */
  bodyAttack?:  BodyBox;

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
    width: 48,
    height: 48,
    speed: 55,
    // Rat sprite is a 32×32 frame, displayed at 48×48 (1.5× scale). Body
    // values are in texture pixels — Phaser scales them to display space.
    // Walking frames: rat is low and wide along the bottom of the frame.
    bodyWalking: { width: 26, height: 16, offsetX: 3, offsetY: 16 },
    // Idle frames: rat sits upright, narrower and taller, centered higher.
    bodyIdle:    { width: 16, height: 24, offsetX: 8, offsetY: 8  },
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
  jumper: {
    kind: 'jumper',
    textureKey: 'jumper',
    width: 83,
    height: 83,
    speed: 0, // stationary; state machine drives animation only
    // 256×256 source frame, displayed at 83×83. Boxes are in texture pixels,
    // authored for the default rightward orientation (clamp base on the left).
    // Retracted: mount + clamp hugging the wall side of the frame.
    bodyIdle:   { width: 150, height: 150, offsetX: 30, offsetY: 55 },
    // Extended: clamp reaches further into open air (wider box).
    bodyAttack: { width: 210, height: 150, offsetX: 30, offsetY: 55 },
    spawnOnHeapSurface: false,
    spawnOnHeapWall: true,
    displayName: 'JUMPER CABLES',
    scoreValue: 150,
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
  jumper: {
    spawnStartPxAboveFloor: 3000,
    spawnEndPxAboveFloor: -1,
    spawnRampPxAboveFloor: 18000,
    spawnChanceMin: 0.10,
    spawnChanceMax: 0.30,
  },
};
