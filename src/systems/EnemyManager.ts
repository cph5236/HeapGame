// src/systems/EnemyManager.ts
import Phaser from 'phaser';
import { AudioManager, distanceToProximityT } from './AudioManager';
import { Enemy, applyBodyBox, mirrorBodyBox } from '../entities/Enemy';
import { ENEMY_DEFS, EnemyDef, DEFAULT_ENEMY_PARAMS } from '../data/enemyDefs';
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
  computeWallFace,
  jumperNextState,
  type WallFace,
  type JumperState,
} from './EnemySpawnMath';

export { isPointInsidePolygon, computeSurfaceAngle, spawnChance, scaleSpawnChance, computeGhostFlip, insetPatrolBounds, shouldPatrol, computeWallFace, jumperNextState };

const SURFACE_ANGLE_THRESHOLD = 30; // degrees — below this is a surface, above is a wall
const RAT_IDLE_MS = 1000;
const MIN_ENEMY_SPACING_PX = 100; // min horizontal gap between enemies spawned in the same band
const JUMPER_IDLE_ALT_MS = 1000;
const JUMPER_FRAME_W = 256; // texture-frame width, for body-box mirroring
// How far the jumper's sprite CENTRE sits off the wall edge along the outward
// normal. Small + positive: the inner half of the sprite embeds INTO the wall
// (hidden behind the trash — see the depth-2 render in Enemy.ts) while the clamp
// pokes into open air. Seating into the wall (rather than fully clear of it)
// means a receding/jagged face can't leave the base floating in open space.
const JUMPER_WALL_SEAT_PX = 45;
// Coarse filter for degenerate tiny facets. With the base embedded + occluded,
// short edges read as "emerging from the trash" rather than floating/buried, so
// this only needs to reject slivers too small to host the enemy at all — kept
// low so Infinite's jagged silhouette still spawns jumpers.
const JUMPER_MIN_WALL_LEN_PX = 40;
const JUMPER_ATTACK_RANGE_PX = 140;
// Min telegraph so the lunge anim always plays; the clamp then holds out while
// the player stays in range (so they meet a live clamp), capped by the max.
const JUMPER_ATTACK_MIN_MS = 500;
const JUMPER_ATTACK_MAX_MS = 1400;
const JUMPER_COOLDOWN_MS = 3000;

type RatStateName = 'walk-right' | 'idle-right' | 'walk-left' | 'idle-left' | 'stationary';

/**
 * Per-enemy runtime state, kept in a Map keyed on the sprite. Avoids the
 * DataManager overhead of reading 7+ keys via getData() every frame per enemy.
 */
interface EnemyRuntime {
  kind: 'percher' | 'ghost' | 'jumper';
  speed: number;
  // Percher (rat) only:
  minX?: number;
  maxX?: number;
  minY?: number;
  maxY?: number;
  ratState?: RatStateName;
  idleUntil?: number;
  // Jumper only:
  jumperState?: JumperState;
  stateSince?: number;   // scene.time.now when the current jumperState was entered
  outwardX?: number;     // -1 or +1: open-air direction (flip + knockback)
  idleAltAt?: number;    // next time to toggle idle-1/idle-2 while idle
  idleShowing2?: boolean;
  attackToggle?: boolean; // alternate attack-1/attack-2 for variety
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
    // Merge over defaults so newly-added kinds (e.g. jumper) spawn on heaps
    // whose stored enemy_params predate them. Per-heap keys still override.
    this._enemyParams = { ...DEFAULT_ENEMY_PARAMS, ...params };
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
      const isWallEdge = angle >= SURFACE_ANGLE_THRESHOLD;
      // Surface enemies anchor at the top vertex (they stand on the surface);
      // wall enemies anchor at the edge's vertical MIDDLE, so a jumper seats in
      // the centre of the wall run rather than up in the top corner.
      const spawnY = isWallEdge ? (v1.y + v2.y) / 2 : Math.min(v1.y, v2.y);
      // Patrol bounds: inset from the edge ends so the rat turns shy of the
      // corners (stays on the visible surface, never walks into the heap).
      const leftV  = v1.x <= v2.x ? v1 : v2;
      const rightV = v1.x <= v2.x ? v2 : v1;
      const { minX, maxX, minY, maxY } = insetPatrolBounds(leftV, rightV, RAT_PATROL_END_MARGIN_PX);
      // Reject wall edges too short to seat the jumper sprite flush (see const).
      const wallLongEnough = Math.hypot(v2.x - v1.x, v2.y - v1.y) >= JUMPER_MIN_WALL_LEN_PX;
      const wallFace = isWallEdge && wallLongEnough
        ? computeWallFace(v1, v2, this.heapPolygon.length > 0 ? this.heapPolygon : vertices)
        : undefined;
      for (const def of Object.values(ENEMY_DEFS)) {
        if (spawned >= maxEnemies) break;
        if (this.trySpawn(def, spawnX, spawnY, angle, minX, maxX, minY, maxY, wallFace ?? undefined)) {
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
      } else if (rt.kind === 'jumper') {
        const body = s.body as Phaser.Physics.Arcade.Body;
        const dx = s.x - playerX;
        const dy = s.y - playerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const prev = rt.jumperState ?? 'idle';
        const msInState = now - (rt.stateSince ?? now);
        const next = jumperNextState(prev, msInState, dist, {
          attackRangePx: JUMPER_ATTACK_RANGE_PX,
          attackMinMs: JUMPER_ATTACK_MIN_MS,
          attackMaxMs: JUMPER_ATTACK_MAX_MS,
          cooldownMs: JUMPER_COOLDOWN_MS,
        });

        const flipped = rt.outwardX !== undefined && rt.outwardX < 0;
        const idleBox   = ENEMY_DEFS.jumper.bodyIdle!;
        const attackBox = ENEMY_DEFS.jumper.bodyAttack!;
        const boxFor = (b: typeof idleBox) => (flipped ? mirrorBodyBox(b, JUMPER_FRAME_W) : b);

        if (next !== prev) {
          rt.jumperState = next;
          rt.stateSince = now;
          if (next === 'attacking') {
            const key = rt.attackToggle ? 'jumper-attack-2' : 'jumper-attack-1';
            rt.attackToggle = !rt.attackToggle;
            s.play(key);
            applyBodyBox(body, boxFor(attackBox));
            s.setData('vulnerable', false);
          } else if (next === 'cooldown') {
            // Disarmed tell: idle-1 only.
            s.play('jumper-idle-1');
            rt.idleShowing2 = false;
            applyBodyBox(body, boxFor(idleBox));
            s.setData('vulnerable', true);
          } else {
            // back to idle (armed)
            s.play('jumper-idle-1');
            rt.idleShowing2 = false;
            rt.idleAltAt = now + JUMPER_IDLE_ALT_MS;
            applyBodyBox(body, boxFor(idleBox));
            s.setData('vulnerable', true);
          }
        } else if (next === 'idle' && now >= (rt.idleAltAt ?? 0)) {
          // Alternate idle-1/idle-2 while armed.
          rt.idleShowing2 = !rt.idleShowing2;
          s.play(rt.idleShowing2 ? 'jumper-idle-2' : 'jumper-idle-1');
          rt.idleAltAt = now + JUMPER_IDLE_ALT_MS;
        }
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
    wallFace?: WallFace,
  ): boolean {
    const isSurface = surfaceAngle < SURFACE_ANGLE_THRESHOLD;
    const isWall    = surfaceAngle >= SURFACE_ANGLE_THRESHOLD;

    if (def.spawnOnHeapSurface && !isSurface) return false;
    if (def.spawnOnHeapWall    && !isWall)    return false;
    if (!def.spawnOnHeapSurface && !def.spawnOnHeapWall) return false;

    if (isWall) {
      // Wall enemies need a resolved open-air face; the surface "point above"
      // interior test does not apply (open air is horizontal, not up).
      if (!wallFace) return false;
    } else {
      // Reject interior edges: the space just above an exterior surface is open air
      // (outside the polygon). Interior ledges and walls still have heap above them.
      if (this.heapPolygon.length > 0 && isPointInsidePolygon(x, y - 1, this.heapPolygon)) return false;
    }

    const spawnParams = this._enemyParams[def.kind];
    if (!spawnParams) return false;
    const pxAboveFloor = this._worldHeight - y;
    const rawChance = spawnChance(spawnParams, pxAboveFloor);
    if (rawChance === null) return false;
    const chance = scaleSpawnChance(rawChance, this._spawnRateMult);
    if (Math.random() >= chance) return false;

    // Placement: surface enemies sit centered above the edge; wall enemies sit
    // just off the wall face in open air, at the edge midpoint height.
    let spawnX = x;
    let spawnY = y - def.height / 2;
    if (isWall && wallFace) {
      // Seat the sprite centre just off the face: inner half embeds into the wall
      // (hidden by the depth-2 render), clamp pokes into open air.
      const offset = JUMPER_WALL_SEAT_PX;
      spawnX = x + wallFace.nx * offset;
      spawnY = y + wallFace.ny * offset; // y here is the edge midpoint top; nudge along normal
    }

    const enemy = new Enemy(this.scene, this.group, spawnX, spawnY, def);

    const rt: EnemyRuntime = {
      kind: def.kind as 'percher' | 'ghost' | 'jumper',
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
    } else if (def.kind === 'jumper' && wallFace) {
      rt.jumperState = 'idle';
      rt.stateSince = this.scene.time.now;
      rt.outwardX = wallFace.outwardX;
      // Expose the open-air direction to scene overlap callbacks so the stun
      // knockback always ejects away from the wall (the sprite is seated INTO
      // the wall, so player.x - e.x can flip sign and toss the player inward).
      enemy.sprite.setData('outwardX', wallFace.outwardX);
      rt.idleAltAt = this.scene.time.now + JUMPER_IDLE_ALT_MS;
      rt.idleShowing2 = false;
      rt.attackToggle = false;
      // Flip to face open air; mirror the idle body box when flipped.
      if (wallFace.outwardX < 0) {
        enemy.sprite.setFlipX(true);
        const body = enemy.sprite.body as Phaser.Physics.Arcade.Body;
        if (def.bodyIdle) applyBodyBox(body, mirrorBodyBox(def.bodyIdle, JUMPER_FRAME_W));
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
