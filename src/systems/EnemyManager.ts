// src/systems/EnemyManager.ts
import Phaser from 'phaser';
import { AudioManager, distanceToProximityT } from './AudioManager';
import { Enemy, applyBodyBox } from '../entities/Enemy';
import { ENEMY_DEFS, EnemyDef } from '../data/enemyDefs';
import { SOUND_DEFS } from '../data/soundDefs';
import type { HeapEnemyParams } from '../../shared/heapTypes';
import { CHUNK_BAND_HEIGHT, ENEMY_CULL_DISTANCE, MOCK_HEAP_HEIGHT_PX, RAT_MIN_PATROL_PX, RAT_PATROL_END_MARGIN_PX, WORLD_WIDTH } from '../constants';
import type { Vertex } from './HeapPolygon';
import type { HeapEntry } from '../data/heapTypes';
import { OBJECT_DEFS } from '../data/heapObjectDefs';
import {
  isPointInsidePolygon,
  computeSurfaceAngle,
  spawnChance,
  scaleSpawnChance,
  computeGhostFlip,
  insetPatrolBounds,
  shouldPatrol,
} from './EnemySpawnMath';

export { isPointInsidePolygon, computeSurfaceAngle, spawnChance, scaleSpawnChance, computeGhostFlip, insetPatrolBounds, shouldPatrol };

const SURFACE_ANGLE_THRESHOLD = 30; // degrees — below this is a surface, above is a wall
const RAT_IDLE_MS = 1000;
const MIN_ENEMY_SPACING_PX = 100; // min horizontal gap between enemies spawned in the same band

type RatStateName = 'walk-right' | 'idle-right' | 'walk-left' | 'idle-left' | 'stationary';

/**
 * Per-enemy runtime state, kept in a Map keyed on the sprite. Avoids the
 * DataManager overhead of reading 7+ keys via getData() every frame per enemy.
 */
interface EnemyRuntime {
  kind: 'percher' | 'ghost';
  speed: number;
  // Percher (rat) only:
  minX?: number;
  maxX?: number;
  minY?: number;
  maxY?: number;
  ratState?: RatStateName;
  idleUntil?: number;
}

export class EnemyManager {
  /** Arcade group — use this for overlap registration in GameScene */
  readonly group: Phaser.Physics.Arcade.Group;

  private readonly scene: Phaser.Scene;
  private heapPolygon: Vertex[] = [];
  private _spawnRateMult: number;
  private readonly _xMin: number;
  private readonly _xMax: number;
  private readonly _worldHeight: number;
  private _enemyParams: HeapEnemyParams = {};
  private readonly runtime = new Map<Phaser.Physics.Arcade.Sprite, EnemyRuntime>();
  private proximityNextAt = 0;
  private ratChirpAt      = 0;

  constructor(
    scene: Phaser.Scene,
    spawnRateMult: number = 1.0,
    xMin: number = 0,
    xMax: number = WORLD_WIDTH,
    worldHeight: number = MOCK_HEAP_HEIGHT_PX,
  ) {
    this.scene = scene;
    this.group = scene.physics.add.group();
    this._spawnRateMult = spawnRateMult;
    this._xMin = xMin;
    this._xMax = xMax;
    this._worldHeight = worldHeight;
  }

  setSpawnRateMult(mult: number): void {
    this._spawnRateMult = mult;
  }

  setEnemyParams(params: HeapEnemyParams): void {
    this._enemyParams = params;
  }

  /** Update the heap polygon used for interior-spawn rejection. Call after every polygon load. */
  setPolygon(polygon: Vertex[]): void {
    this.heapPolygon = polygon;
  }

  /**
   * Call this from the HeapGenerator.onPlatformSpawned callback.
   * entry is passed so we can derive platform width for rat patrol bounds.
   * blockPlaced guards against spawning enemies on the player's own summit block.
   */
  onPlatformSpawned(x: number, platformTopY: number, blockPlaced: boolean, entry?: HeapEntry, maxEnemies = Infinity): void {
    if (blockPlaced) return;
    let minX: number | undefined;
    let maxX: number | undefined;
    if (entry) {
      const def = OBJECT_DEFS[entry.keyid];
      if (def) {
        // Inset from the object's ends too, so rats stop shy of the edges.
        // Flat top → minY/maxY stay platformTopY (passed below).
        const b = insetPatrolBounds(
          { x: entry.x - def.width / 2, y: platformTopY },
          { x: entry.x + def.width / 2, y: platformTopY },
          RAT_PATROL_END_MARGIN_PX,
        );
        minX = b.minX;
        maxX = b.maxX;
      }
    }
    let spawned = 0;
    for (const def of Object.values(ENEMY_DEFS)) {
      if (spawned >= maxEnemies) break;
      if (this.trySpawn(def, x, platformTopY, 0, minX, maxX, platformTopY, platformTopY)) spawned++;
    }
  }

  /**
   * Call this when a band polygon is applied from the server path.
   * Iterates polygon edges to find spawnable surfaces.
   */
  onBandLoaded(bandTopY: number, vertices: Vertex[], maxEnemies = Infinity): void {
    if (vertices.length < 2) return;
    const bandBottomY = bandTopY + CHUNK_BAND_HEIGHT;
    const EPS = 0.5;
    let spawned = 0;
    let lastSpawnX = -Infinity;
    for (let i = 0; i < vertices.length; i++) {
      if (spawned >= maxEnemies) break;
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % vertices.length];
      // Skip artificial horizontal edges inserted at band-clip boundaries — these
      // cross the interior of the heap body and are not real spawnable surfaces.
      const atTopCut    = Math.abs(v1.y - bandTopY)    < EPS && Math.abs(v2.y - bandTopY)    < EPS;
      const atBottomCut = Math.abs(v1.y - bandBottomY) < EPS && Math.abs(v2.y - bandBottomY) < EPS;
      if (atTopCut || atBottomCut) continue;
      const angle = computeSurfaceAngle(v1, v2);
      const spawnX = (v1.x + v2.x) / 2;
      if (Math.abs(spawnX - lastSpawnX) < MIN_ENEMY_SPACING_PX) continue;
      const spawnY = Math.min(v1.y, v2.y);
      // Patrol bounds: inset from the edge ends so the rat turns shy of the
      // corners (stays on the visible surface, never walks into the heap).
      const leftV  = v1.x <= v2.x ? v1 : v2;
      const rightV = v1.x <= v2.x ? v2 : v1;
      const { minX, maxX, minY, maxY } = insetPatrolBounds(leftV, rightV, RAT_PATROL_END_MARGIN_PX);
      for (const def of Object.values(ENEMY_DEFS)) {
        if (spawned >= maxEnemies) break;
        if (this.trySpawn(def, spawnX, spawnY, angle, minX, maxX, minY, maxY)) {
          spawned++;
          lastSpawnX = spawnX;
        }
      }
    }
  }

  /** Call every frame with current camera bounds. */
  update(_camTop: number, camBottom: number, playerX: number, playerY: number): void {
    const now = this.scene.time.now;
    // group.getChildren() returns the internal entries array directly (no copy).
    const children = this.group.getChildren() as Phaser.Physics.Arcade.Sprite[];
    const cullY = camBottom + ENEMY_CULL_DISTANCE;

    // ── Proximity audio (100 ms throttle) ─────────────────────────────────────
    if (now >= this.proximityNextAt) {
      this.proximityNextAt = now + 100;

      // Vulture ambient — continuous loop driven by nearest ghost distance
      const vultureDef = SOUND_DEFS['enemy-vulture-ambient'];
      if (vultureDef?.maxAudibleDistancePx !== undefined) {
        let minDist = Infinity;
        for (const s of children) {
          const rt = this.runtime.get(s);
          if (rt?.kind !== 'ghost') continue;
          const dx = s.x - playerX;
          const dy = s.y - playerY;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < minDist) minDist = d;
        }
        const t = minDist === Infinity ? 0 : distanceToProximityT(
          minDist,
          vultureDef.fullVolumeDistancePx ?? 0,
          vultureDef.maxAudibleDistancePx,
        );
        AudioManager.setLoopProximity('enemy-vulture-ambient', t);
      }

      // Rat chirp — intermittent one-shot at nearest rat distance
      const ratDef = SOUND_DEFS['enemy-rat-ambient'];
      if (ratDef?.maxAudibleDistancePx !== undefined && this.ratCount() > 0 && now >= this.ratChirpAt) {
        let minDist = Infinity;
        for (const s of children) {
          const rt = this.runtime.get(s);
          if (rt?.kind !== 'percher') continue;
          const dx = s.x - playerX;
          const dy = s.y - playerY;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < minDist) minDist = d;
        }
        if (minDist < Infinity) {
          const t = distanceToProximityT(
            minDist,
            ratDef.fullVolumeDistancePx ?? 0,
            ratDef.maxAudibleDistancePx,
          );
          AudioManager.playProximate('enemy-rat-ambient', t);
        }
        const [minMs, maxMs] = ratDef.playIntervalMs ?? [3000, 8000];
        this.ratChirpAt = now + Phaser.Math.Between(minMs, maxMs);
      }
    }

    for (let i = children.length - 1; i >= 0; i--) {
      const s = children[i];
      if (s.y > cullY) {
        this.runtime.delete(s);
        s.destroy();
        continue;
      }

      const rt = this.runtime.get(s);
      if (!rt) continue;

      if (rt.kind === 'percher') {
        const body = s.body as Phaser.Physics.Arcade.Body;
        const minX = rt.minX ?? s.x;
        const maxX = rt.maxX ?? s.x;
        const minY = rt.minY ?? s.y;
        const maxY = rt.maxY ?? s.y;

        // Follow the slope: interpolate Y based on current body X (post-step).
        // body.center.x reflects physics movement this frame; s.x is one frame stale.
        if (maxX > minX) {
          const t = Phaser.Math.Clamp((body.center.x - minX) / (maxX - minX), 0, 1);
          const targetY = minY + t * (maxY - minY);
          body.position.y = targetY - body.halfHeight;
        }

        // Rat sprite has different proportions when walking (low + wide) vs
        // idle (upright + narrow); swap body boxes per transition so the
        // collision rect tracks the visible animation.
        const walkBox = ENEMY_DEFS.percher.bodyWalking;
        const idleBox = ENEMY_DEFS.percher.bodyIdle;

        switch (rt.ratState) {
          case 'walk-right':
            if (s.x >= maxX) {
              body.setVelocityX(0);
              rt.ratState = 'idle-right';
              rt.idleUntil = now + RAT_IDLE_MS;
              s.play('rat-idle');
              if (idleBox) applyBodyBox(body, idleBox);
            }
            break;
          case 'idle-right':
            if (now >= (rt.idleUntil ?? 0)) {
              body.setVelocityX(-rt.speed);
              rt.ratState = 'walk-left';
              s.play('rat-walk-left');
              if (walkBox) applyBodyBox(body, walkBox);
            }
            break;
          case 'walk-left':
            if (s.x <= minX) {
              body.setVelocityX(0);
              rt.ratState = 'idle-left';
              rt.idleUntil = now + RAT_IDLE_MS;
              s.play('rat-idle');
              if (idleBox) applyBodyBox(body, idleBox);
            }
            break;
          case 'idle-left':
            if (now >= (rt.idleUntil ?? 0)) {
              body.setVelocityX(rt.speed);
              rt.ratState = 'walk-right';
              s.play('rat-walk-right');
              if (walkBox) applyBodyBox(body, walkBox);
            }
            break;
        }
      } else if (rt.kind === 'ghost') {
        const body = s.body as Phaser.Physics.Arcade.Body;

        // Manually flip at column edges — avoids the oscillation that setBounce causes
        const newVx = computeGhostFlip(s.x, body.velocity.x, rt.speed, this._xMin, this._xMax);
        if (newVx !== body.velocity.x) body.setVelocityX(newVx);

        const wantAnim = body.velocity.x < 0 ? 'vulture-fly-left' : 'vulture-fly-right';
        if (s.anims.currentAnim?.key !== wantAnim) s.play(wantAnim);
      }
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private trySpawn(
    def: EnemyDef,
    x: number,
    y: number,
    surfaceAngle: number,
    minX?: number,
    maxX?: number,
    minY?: number,
    maxY?: number,
  ): boolean {
    const isSurface = surfaceAngle < SURFACE_ANGLE_THRESHOLD;
    const isWall    = surfaceAngle >= SURFACE_ANGLE_THRESHOLD;

    if (def.spawnOnHeapSurface && !isSurface) return false;
    if (def.spawnOnHeapWall    && !isWall)    return false;
    if (!def.spawnOnHeapSurface && !def.spawnOnHeapWall) return false;

    // Reject interior edges: the space just above an exterior surface is open air
    // (outside the polygon). Interior ledges and walls still have heap above them.
    if (this.heapPolygon.length > 0 && isPointInsidePolygon(x, y - 1, this.heapPolygon)) return false;

    const spawnParams = this._enemyParams[def.kind];
    if (!spawnParams) return false;
    const pxAboveFloor = this._worldHeight - y;
    const rawChance = spawnChance(spawnParams, pxAboveFloor);
    if (rawChance === null) return false;
    const chance = scaleSpawnChance(rawChance, this._spawnRateMult);
    if (Math.random() >= chance) return false;

    const spawnY = y - def.height / 2;
    const enemy = new Enemy(this.scene, this.group, x, spawnY, def);

    const rt: EnemyRuntime = {
      kind: def.kind as 'percher' | 'ghost',
      speed: def.speed,
    };
    if (def.kind === 'percher' && minX !== undefined && maxX !== undefined) {
      const halfH = def.height / 2;
      rt.minX = minX;
      rt.maxX = maxX;
      rt.minY = (minY ?? spawnY + halfH) - halfH;
      rt.maxY = (maxY ?? spawnY + halfH) - halfH;
      if (shouldPatrol(minX, maxX, RAT_MIN_PATROL_PX)) {
        rt.ratState = 'walk-right';
        rt.idleUntil = 0;
      } else {
        // Surface too narrow to patrol without twitching — stand still.
        rt.ratState = 'stationary';
        const body = enemy.sprite.body as Phaser.Physics.Arcade.Body;
        body.setVelocityX(0);
        enemy.sprite.play('rat-idle');
        const idleBox = ENEMY_DEFS.percher.bodyIdle;
        if (idleBox) applyBodyBox(body, idleBox);
      }
    }
    this.runtime.set(enemy.sprite, rt);
    // External destroys (stomp, scene shutdown) bypass our cull loop;
    // keep the runtime Map from leaking by listening for the destroy event.
    enemy.sprite.once(Phaser.GameObjects.Events.DESTROY, () => {
      this.runtime.delete(enemy.sprite);
    });
    return true;
  }

  private ratCount(): number {
    let n = 0;
    for (const rt of this.runtime.values()) {
      if (rt.kind === 'percher') n++;
    }
    return n;
  }
}
