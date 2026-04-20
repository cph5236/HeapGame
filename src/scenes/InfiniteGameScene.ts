import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { HeapGenerator } from '../systems/HeapGenerator';
import { HeapChunkRenderer } from '../systems/HeapChunkRenderer';
import { HeapEdgeCollider } from '../systems/HeapEdgeCollider';
import { EnemyManager } from '../systems/EnemyManager';
import { TrashWallManager } from '../systems/TrashWallManager';
import { PlaceableManager } from '../systems/PlaceableManager';
import { BridgeSpawner } from '../systems/BridgeSpawner';
import { PortalManager } from '../systems/PortalManager';
import { CameraController } from '../systems/CameraController';
import { InputManager } from '../systems/InputManager';
import { HUD } from '../ui/HUD';
import { ParallaxBackground } from '../systems/ParallaxBackground';
import { LayerGenerator } from '../systems/LayerGenerator';
import { computeBandPolygon, simplifyPolygon } from '../systems/HeapPolygon';
import { buildRunScore } from '../systems/buildRunScore';
import { getPlayerConfig, addBalance } from '../systems/SaveData';
import { ENEMY_DEFS } from '../data/enemyDefs';
import { BRIDGE_DEF } from '../data/bridgeDefs';
import { PORTAL_DEF } from '../data/portalDefs';
import { TRASH_WALL_DEF } from '../data/trashWallDef';
import {
  INFINITE_HEAP_ID,
  INFINITE_MIN_SPAWN_MULT,
  INFINITE_MAX_SPAWN_MULT,
  computeDifficultyFactor,
} from '../data/infiniteDefs';
import {
  WORLD_WIDTH,
  MOCK_HEAP_HEIGHT_PX,
  GEN_LOOKAHEAD,
  INFINITE_WORLD_WIDTH,
  INFINITE_GAP_WIDTH,
  INFINITE_EDGE_PAD,
  PLAYER_HEIGHT,
  PLAYER_JUMP_VELOCITY,
  PLAYER_INVINCIBLE_MS,
  CHUNK_BAND_HEIGHT,
  INFINITE_LOOKAHEAD_CHUNKS,
} from '../constants';
import { DEFAULT_HEAP_PARAMS } from '../../shared/heapTypes';
import type { EnemyKind } from '../entities/Enemy';

function makeColBounds(): [number, number][] {
  const p = INFINITE_EDGE_PAD;
  const w = WORLD_WIDTH;
  const g = INFINITE_GAP_WIDTH;
  return [
    [p,             p + w],
    [p + w + g,     p + w * 2 + g],
    [p + w * 2 + g * 2, p + w * 3 + g * 2],
  ];
}

export class InfiniteGameScene extends Phaser.Scene {
  private player!: Player;
  private hud!: HUD;
  private im!: InputManager;
  private scoreText!: Phaser.GameObjects.Text;

  private walkableGroups: Phaser.Physics.Arcade.StaticGroup[] = [];
  private wallGroups:     Phaser.Physics.Arcade.StaticGroup[] = [];
  private generators:     HeapGenerator[]  = [];
  private layerGenerators: LayerGenerator[] = [];
  private enemyManagers:  EnemyManager[]   = [];
  private trashWallManager!: TrashWallManager;
  private placeableManager!: PlaceableManager;
  private bridgeSpawner!:    BridgeSpawner;
  private portalManager!:    PortalManager;

  private spawnY:        number  = 0;
  private invincible:    boolean = false;
  private _runStartTime: number | null = null;
  private _runKills:     Partial<Record<EnemyKind, number>> = {};
  private colBounds:        [number, number][] = [];
  private colSeeds:         number[] = [];
  private spawnedBands:     Set<number>[] = [];
  private playerConfig!: ReturnType<typeof getPlayerConfig>;
  private debugMode = false;
  private debugText?: Phaser.GameObjects.Text;
  private noclipButton?: Phaser.GameObjects.Text;
  private debugNoclip = false;
  private heapColliders: Phaser.Physics.Arcade.Collider[] = [];

  constructor() { super({ key: 'InfiniteGameScene' }); }

  create(): void {
    this._runKills     = {};
    this._runStartTime = null;
    this.invincible    = false;
    this.generators    = [];
    this.layerGenerators = [];
    this.enemyManagers = [];
    this.walkableGroups = [];
    this.wallGroups     = [];
    this.spawnedBands   = [new Set(), new Set(), new Set()];

    // No left/right walls — manual wrap handles X. Keep top/bottom.
    this.physics.world.setBounds(0, 0, INFINITE_WORLD_WIDTH, MOCK_HEAP_HEIGHT_PX, false, false, true, true);
    this.colBounds    = makeColBounds();
    this.playerConfig = getPlayerConfig();

    // ── 3 heap columns ─────────────────────────────────────────────────────────
    this.colSeeds = [];

    for (let i = 0; i < 3; i++) {
      const seed    = Math.floor(Math.random() * 1_000_000);
      this.colSeeds.push(seed);
      const [xMin, xMax] = this.colBounds[i];
      const walkable = this.physics.add.staticGroup();
      const wall     = this.physics.add.staticGroup();
      const renderer = new HeapChunkRenderer(this, xMin, xMax - xMin);
      const edge     = new HeapEdgeCollider(this, this.playerConfig.maxWalkableSlopeDeg);
      const gen      = new HeapGenerator(this, walkable, wall, [], renderer, edge);

      const layerGen = new LayerGenerator(seed, xMin, xMax, MOCK_HEAP_HEIGHT_PX);
      this.layerGenerators.push(layerGen);

      const em = new EnemyManager(this, 1.0, xMin, xMax);

      const colIdx = i;
      gen.onBandLoaded = (bandTopY, vertices) => {
        em.setPolygon(vertices);
        if (!this.spawnedBands[colIdx].has(bandTopY)) {
          this.spawnedBands[colIdx].add(bandTopY);
          em.onBandLoaded(bandTopY, vertices);
        }
        if (colIdx === 0) {
          this.bridgeSpawner?.onBandLoaded(bandTopY);
          this.portalManager?.onBandLoaded(bandTopY);
        }
      };

      this.walkableGroups.push(walkable);
      this.wallGroups.push(wall);
      this.generators.push(gen);
      this.enemyManagers.push(em);
    }

    // ── Player (gap between col 0 and col 1 — no heap there) ───────────────────
    const gapX = (this.colBounds[0][1] + this.colBounds[1][0]) / 2;
    this.spawnY = MOCK_HEAP_HEIGHT_PX - PLAYER_HEIGHT / 2 - 1;
    this.player = new Player(this, gapX, this.spawnY, this.playerConfig);
    this.player.worldWidth = INFINITE_WORLD_WIDTH;

    // ── Colliders ───────────────────────────────────────────────────────────────
    this.heapColliders = [];
    type AP = Phaser.Types.Physics.Arcade.ArcadePhysicsCallback;
    for (let i = 0; i < 3; i++) {
      this.heapColliders.push(this.physics.add.collider(this.player.sprite, this.walkableGroups[i]));
      this.heapColliders.push(this.physics.add.collider(
        this.player.sprite, this.wallGroups[i],
        this.onHeapWallCollide as unknown as AP, undefined, this,
      ));
    }

    // ── Bridge spawner ──────────────────────────────────────────────────────────
    this.bridgeSpawner = new BridgeSpawner(
      this,
      this.generators as [HeapGenerator, HeapGenerator, HeapGenerator],
      this.colBounds,
      BRIDGE_DEF,
    );
    this.heapColliders.push(this.physics.add.collider(this.player.sprite, this.bridgeSpawner.group));

    // ── Portal manager ──────────────────────────────────────────────────────────
    this.portalManager = new PortalManager(
      this, this.player, this.colBounds, PORTAL_DEF,
      (ms) => {
        this.invincible = true;
        this.time.delayedCall(ms, () => { this.invincible = false; });
      },
    );

    // ── Trash wall ───────────────────────────────────────────────────────────────
    this.trashWallManager = new TrashWallManager(this, TRASH_WALL_DEF, () => {
      this.handleDeath();
    }, INFINITE_WORLD_WIDTH);
    this.trashWallManager.spawn(this.player.sprite.y);

    // ── Placeable manager ────────────────────────────────────────────────────────
    this.placeableManager = new PlaceableManager(
      this, this.player, this.walkableGroups[0], this.wallGroups[0],
      INFINITE_HEAP_ID,
      (_x, _savedY) => false,  // no surface restoration — no entries in LayerGenerator mode
      true, // excludeCheckpoint
    );

    // ── Enemy overlaps ───────────────────────────────────────────────────────────
    for (const em of this.enemyManagers) {
      this.physics.add.overlap(
        this.player.sprite, em.group,
        this.handleStomp as unknown as AP,
        this.isStomping as unknown as AP,
        this,
      );
      this.physics.add.overlap(
        this.player.sprite, em.group,
        this.handleEnemyDamage as unknown as AP,
        this.isDamaging as unknown as AP,
        this,
      );
    }

    // ── Camera ───────────────────────────────────────────────────────────────────
    CameraController.setup(this, this.player.sprite, INFINITE_WORLD_WIDTH, MOCK_HEAP_HEIGHT_PX);

    // ── HUD / score text ─────────────────────────────────────────────────────────
    this.hud = new HUD(this, this.player, this.placeableManager);
    this.scoreText = this.add.text(8, 8, '0 ft', {
      fontSize: '18px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 2,
    }).setScrollFactor(0).setDepth(20);

    this.im = InputManager.getInstance();
    this.input.keyboard!.on('keydown-R', () => this.placeableManager.openHotbar());
    this.input.keyboard!.on('keydown-F2', () => this.toggleDebugMode());

    // ── Debug overlay ─────────────────────────────────────────────────────────────
    this.debugText = this.add.text(8, 30, '', {
      fontSize: '12px', color: '#00ff88', stroke: '#000000', strokeThickness: 2,
      backgroundColor: '#00000099', padding: { x: 4, y: 3 },
    }).setScrollFactor(0).setDepth(30).setVisible(false);

    this.noclipButton = this.add.text(8, 110, '[ NOCLIP: OFF ]', {
      fontSize: '12px', color: '#ffff00', stroke: '#000000', strokeThickness: 2,
      backgroundColor: '#333333', padding: { x: 4, y: 2 },
    }).setScrollFactor(0).setDepth(30).setVisible(false).setInteractive()
      .on('pointerdown', () => this.toggleNoclip());

    // ── Background ────────────────────────────────────────────────────────────────
    new ParallaxBackground(this);

    // ── Initial generation (sync so collision is ready frame 1) ──────────────────
    for (let i = 0; i < 3; i++) {
      const gen      = this.generators[i];
      const layerGen = this.layerGenerators[i];
      const targetY  = this.spawnY - GEN_LOOKAHEAD;
      while (layerGen.nextBandTop > targetY) {
        const { bandTop, rows } = layerGen.nextChunk();
        const polygon = simplifyPolygon(computeBandPolygon(rows), 2);
        if (polygon.length >= 3) gen.applyBandPolygon(bandTop, polygon);
      }
    }
  }

  update(_time: number, delta: number): void {
    const score = Math.max(0, Math.floor(this.spawnY - this.player.sprite.y));
    if (score > 0 && this._runStartTime === null) {
      this._runStartTime = this.time.now;
    }
    this.scoreText.setText(`${Math.floor(score / 100)} ft`);

    // ── Player + input ────────────────────────────────────────────────────────────
    this.im.update(delta, false);
    this.player.update(delta);
    this.placeableManager.update();
    this.hud.update();

    // ── Heap generation ───────────────────────────────────────────────────────────
    const cam    = this.cameras.main;
    const camTop = cam.worldView.top;
    const camBot = cam.worldView.bottom;

    // Layer generation — drive each column ahead of the player
    const targetY = this.player.sprite.y - INFINITE_LOOKAHEAD_CHUNKS * CHUNK_BAND_HEIGHT;
    for (let i = 0; i < 3; i++) {
      const gen      = this.generators[i];
      const layerGen = this.layerGenerators[i];
      while (layerGen.nextBandTop > targetY) {
        const { bandTop, rows } = layerGen.nextChunk();
        gen.sendLayerBatch(bandTop, rows);
      }
      gen.flushWorkerResults();
    }

    // ── Difficulty ramp ───────────────────────────────────────────────────────────
    const elapsed = this._runStartTime !== null ? this.time.now - this._runStartTime : 0;
    const factor  = computeDifficultyFactor(score, elapsed);
    const spawnMult = INFINITE_MIN_SPAWN_MULT +
      factor * (INFINITE_MAX_SPAWN_MULT - INFINITE_MIN_SPAWN_MULT);

    for (const em of this.enemyManagers) {
      em.setSpawnRateMult(spawnMult);
      em.update(camTop, camBot);
    }

    this.trashWallManager.update(this.player.sprite.y, delta);
    this.portalManager.update();

    // ── Noclip — refund air jump every frame so player has infinite jumps ─────────
    if (this.debugNoclip) {
      this.player.refundAirJump();
    }

    // ── Debug overlay ─────────────────────────────────────────────────────────────
    if (this.debugMode && this.debugText) {
      const px = Math.round(this.player.sprite.x);
      const py = Math.round(this.player.sprite.y);
      const col = this.colBounds.findIndex(([mn, mx]) => px >= mn && px <= mx);
      const colLabel = col >= 0 ? `col ${col}` : 'gap';
      const totalEnemies = this.enemyManagers.reduce((n, em) => n + em.group.getLength(), 0);
      this.debugText.setText([
        `Player: (${px}, ${py})  ${colLabel}`,
        `Cam: (${Math.round(cam.scrollX)}, ${Math.round(cam.scrollY)})`,
        `Score: ${Math.floor(score / 100)} ft  elapsed: ${Math.round(elapsed / 1000)}s`,
        `Difficulty: ${factor.toFixed(2)}  spawnMult: ${spawnMult.toFixed(2)}`,
        `Enemies: ${totalEnemies}`,
      ].join('\n'));
    }
  }

  private toggleDebugMode(): void {
    this.debugMode = !this.debugMode;
    this.debugText?.setVisible(this.debugMode);
    this.noclipButton?.setVisible(this.debugMode);
    if (this.debugMode) {
      this.physics.world.createDebugGraphic();
      this.physics.world.drawDebug = true;
    } else {
      if (this.debugNoclip) this.toggleNoclip();
      this.physics.world.debugGraphic?.destroy();
      this.physics.world.drawDebug = false;
    }
  }

  private toggleNoclip(): void {
    this.debugNoclip = !this.debugNoclip;
    for (const c of this.heapColliders) {
      c.active = !this.debugNoclip;
    }
    this.noclipButton?.setText(`[ NOCLIP: ${this.debugNoclip ? 'ON ' : 'OFF'} ]`);
  }

  // ── Death ────────────────────────────────────────────────────────────────────

  private handleDeath(): void {
    if (!this.scene.isActive()) return;
    this.player.freeze();
    const score      = Math.max(0, Math.floor(this.spawnY - this.player.sprite.y));
    const elapsedMs  = this._runStartTime !== null ? this.time.now - this._runStartTime : 0;
    const runResult  = buildRunScore(
      { baseHeightPx: score, kills: this._runKills, elapsedMs },
      ENEMY_DEFS,
      true,
      1.0,
    );
    this.time.delayedCall(800, () => {
      this.scene.launch('ScoreScene', {
        score:               runResult.finalScore,
        heapId:              INFINITE_HEAP_ID,
        isPeak:              false,
        checkpointAvailable: false,
        isFailure:           true,
        baseHeightPx:        score,
        kills:               this._runKills,
        elapsedMs,
        heapParams: {
          ...DEFAULT_HEAP_PARAMS,
          name: '∞ Infinite Heap',
          difficulty: 5.0,
          isInfinite: true,
        },
      });
      this.scene.sleep();
    });
  }

  // ── Enemy callbacks (same pattern as GameScene) ───────────────────────────────

  private readonly isStomping = (
    player: Phaser.GameObjects.GameObject,
    enemy:  Phaser.GameObjects.GameObject,
  ): boolean => {
    const p = player as Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
    const e = enemy  as Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
    return p.body.velocity.y > 0 && p.body.center.y < e.body.center.y;
  };

  private readonly isDamaging = (
    player: Phaser.GameObjects.GameObject,
    enemy:  Phaser.GameObjects.GameObject,
  ): boolean => !this.invincible && !this.debugNoclip && !this.isStomping(player, enemy);

  private readonly handleStomp = (
    _player: Phaser.GameObjects.GameObject,
    enemy:   Phaser.GameObjects.GameObject,
  ): void => {
    const e    = enemy as Phaser.Physics.Arcade.Sprite;
    const kind = e.getData('kind') as EnemyKind;
    e.destroy();

    this._runKills[kind] = (this._runKills[kind] ?? 0) + 1;
    this.player.refundAirJump();
    this.player.sprite.setVelocityY(PLAYER_JUMP_VELOCITY);

    const reward = this.playerConfig.stompBonus;
    addBalance(reward);
    const marker = this.add.text(e.x, e.y - 16, `+${reward}`, {
      fontSize: '22px', color: '#ffdd44', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(50);
    this.tweens.add({
      targets: marker, y: e.y - 80, alpha: 0,
      duration: 2000, ease: 'Cubic.Out',
      onComplete: () => marker.destroy(),
    });

    this.invincible = true;
    this.time.delayedCall(PLAYER_INVINCIBLE_MS, () => { this.invincible = false; });
  };

  private readonly handleEnemyDamage = (): void => {
    if (this.player.hasActiveShield) {
      this.player.absorbHit();
      this.invincible = true;
      this.time.delayedCall(PLAYER_INVINCIBLE_MS * 4, () => { this.invincible = false; });
      return;
    }
    this.handleDeath();
  };

  private readonly onHeapWallCollide = (
    playerObj: Phaser.GameObjects.GameObject,
  ): void => {
    const body = (playerObj as Phaser.Types.Physics.Arcade.SpriteWithDynamicBody).body;
    if (body.blocked.down) this.player.inSlopeZone = true;
  };
}
