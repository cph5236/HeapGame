import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { PlayerAnimator } from '../entities/PlayerAnimator';
import { PlayerCosmetics } from '../entities/PlayerCosmetics';
import { PlayerOutro } from '../entities/PlayerOutro';
import { playElectrocutionEffect } from '../entities/effects/electrocution';
import { AudioManager } from '../systems/AudioManager';
import { HeapGenerator } from '../systems/HeapGenerator';
import { HeapChunkRenderer } from '../systems/HeapChunkRenderer';
import { shouldBakeBands } from '../systems/generationPacing';
import { HeapEdgeCollider } from '../systems/HeapEdgeCollider';
import { EnemyManager } from '../systems/EnemyManager';
import { TrashWallManager } from '../systems/TrashWallManager';
import { BuffManager } from '../systems/BuffManager';
import { PlaceableManager } from '../systems/PlaceableManager';
import { PickupManager } from '../systems/PickupManager';
import { BridgeSpawner } from '../systems/BridgeSpawner';
import { PortalManager, findPortalSurfaceFromPolygon } from '../systems/PortalManager';
import { CameraController } from '../systems/CameraController';
import { InputManager } from '../systems/InputManager';
import { mountJoystick } from '../systems/mountJoystick';
import type { JoystickHandle } from '../systems/mountJoystick';
import { setupGameplayUiCamera, addToGameplayUi } from '../systems/GameplayUiCamera';
import { HUD } from '../ui/HUD';
import { EnemyRadar } from '../ui/EnemyRadar';
import { InfiniteLoadingOverlay } from '../ui/InfiniteLoadingOverlay';
import { preloadProgress, preloadComplete } from '../systems/infinitePreload';
import { ParallaxBackground } from '../systems/ParallaxBackground';
import { LayerGenerator } from '../systems/LayerGenerator';
import { computeBandPolygon, simplifyPolygon, type Vertex } from '../systems/HeapPolygon';
import { buildRunScore } from '../systems/buildRunScore';
import { getPlayerConfig, addBalance, getUpgrades, getEffectiveControlMode, getUpgradeLevel, getEquippedCosmetics, getHatAdjustments } from '../systems/SaveData';
import { resolveCosmetics } from '../systems/cosmeticsLogic';
import { showDashIndicator } from '../ui/hudLogic';
import { ENEMY_DEFS, DEFAULT_ENEMY_PARAMS } from '../data/enemyDefs';
import { getLogger } from '../logging';
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
  INFINITE_PREGEN_BANDS,
  INFINITE_PREGEN_MIN_MS,
  INFINITE_WORLD_WIDTH,
  INFINITE_GAP_WIDTH,
  INFINITE_EDGE_PAD,
  PLAYER_HEIGHT,
  PLAYER_JUMP_VELOCITY,
  PLAYER_INVINCIBLE_MS,
  CHUNK_BAND_HEIGHT,
  INFINITE_LOOKAHEAD_CHUNKS,
  MAX_WALL_AUDIBLE_DISTANCE,
  SURFACE_SNAP_TOLERANCE_PX,
  ENEMY_RADAR_BASE_RANGE_PX,
  ENEMY_RADAR_RANGE_PER_LEVEL,
  SCORE_DISPLAY_DIVISOR,
} from '../constants';
import { snapPlayerToSurface, depenetratePlayerFromWall } from '../systems/HeapCollisionHelpers';
import { DEFAULT_HEAP_PARAMS } from '../../shared/heapTypes';
import type { HeapParams } from '../../shared/heapTypes';
import { HeapClient } from '../systems/HeapClient';
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
  private playerAnimator!: PlayerAnimator;
  private playerCosmetics!: PlayerCosmetics;
  private playerOutro!: PlayerOutro;
  private hud!: HUD;
  private im!: InputManager;
  private joystick: JoystickHandle | null = null;

  private walkableGroups: Phaser.Physics.Arcade.StaticGroup[] = [];
  private wallGroups:     Phaser.Physics.Arcade.StaticGroup[] = [];
  private edgeColliders:  HeapEdgeCollider[]                  = [];
  private chunkRenderers: HeapChunkRenderer[]                = [];
  private generators:     HeapGenerator[]  = [];
  private layerGenerators: LayerGenerator[] = [];
  private enemyManagers:  EnemyManager[]   = [];
  private enemyRadar!: EnemyRadar;
  private colBandPolygons: Map<number, Vertex[]>[] = [];
  private trashWallManager!: TrashWallManager;
  private buffManager!:      BuffManager;
  private placeableManager!: PlaceableManager;
  private pickupManager!:    PickupManager;
  private bridgeSpawner!:    BridgeSpawner;
  private portalManager!:    PortalManager;

  private spawnY:        number  = 0;
  private invincible:    boolean = false;
  private _runStartTime: number | null = null;
  private _runKills:     Partial<Record<EnemyKind, number>> = {};
  private _playerDead = false;
  private colBounds:        [number, number][] = [];
  private colSeeds:         number[] = [];
  private spawnedBands:     Set<number>[] = [];
  private playerConfig!: ReturnType<typeof getPlayerConfig>;
  private _heapParams!: HeapParams;
  private debugMode = false;
  private debugText?: Phaser.GameObjects.Text;
  private bridgePenetration = 0;
  private noclipButton?: Phaser.GameObjects.Text;
  private debugNoclip = false;
  private heapColliders: Phaser.Physics.Arcade.Collider[] = [];

  // ── Preload (loading screen) ──────────────────────────────────────────────────
  private _preloading = false;
  private loadingOverlay?: InfiniteLoadingOverlay;
  private _pregenTargetY = 0;
  private _pregenDone = 0;
  private _pregenTotal = 0;
  private _preloadStartMs = 0;

  constructor() { super({ key: 'InfiniteGameScene' }); }

  create(): void {
    // Dedicated UI camera for the (zoomed, following) gameplay scene — must run
    // before any HUD/world objects are created. See GameplayUiCamera.
    setupGameplayUiCamera(this);

    // Drop any tap/swipe buffered before the run began (e.g. the tap on the START
    // RUN button) so it can't leak a jump into this run's first frame.
    InputManager.getInstance().clearBufferedActions();

    this._runKills     = {};
    this._runStartTime = null;
    this._playerDead   = false;
    this.invincible    = false;
    this.generators    = [];
    this.layerGenerators = [];
    this.enemyManagers = [];
    this.walkableGroups = [];
    this.wallGroups     = [];
    this.edgeColliders  = [];
    this.chunkRenderers = [];
    this.spawnedBands      = [new Set(), new Set(), new Set()];
    this.colBandPolygons   = [new Map(), new Map(), new Map()];

    // No left/right walls — manual wrap handles X. Keep top/bottom.
    this.physics.world.setBounds(0, 0, INFINITE_WORLD_WIDTH, MOCK_HEAP_HEIGHT_PX, false, false, true, true);
    this.colBounds    = makeColBounds();
    this.playerConfig = getPlayerConfig();
    this._heapParams = (this.game.registry.get('heapParams') as HeapParams | undefined) ?? DEFAULT_HEAP_PARAMS;

    // ── 3 heap columns ─────────────────────────────────────────────────────────
    this.colSeeds = [];

    for (let i = 0; i < 3; i++) {
      const seed    = Math.floor(Math.random() * 1_000_000);
      this.colSeeds.push(seed);
      const [xMin, xMax] = this.colBounds[i];
      const walkable = this.physics.add.staticGroup();
      const wall     = this.physics.add.staticGroup();
      const renderer = new HeapChunkRenderer(this, xMin, xMax - xMin);
      const edge     = new HeapEdgeCollider(this.playerConfig.maxWalkableSlopeDeg);
      const gen      = new HeapGenerator(this, walkable, wall, [], renderer, edge);

      const layerGen = new LayerGenerator(seed, xMin, xMax, MOCK_HEAP_HEIGHT_PX);
      this.layerGenerators.push(layerGen);

      const em = new EnemyManager(this, 1.0, xMin, xMax);
      em.setEnemyParams(HeapClient.getEnemyParams(INFINITE_HEAP_ID) ?? DEFAULT_ENEMY_PARAMS);

      const colIdx = i;
      gen.onBandLoaded = (bandTopY, vertices) => {
        em.setPolygon(vertices);
        this.colBandPolygons[colIdx].set(bandTopY, vertices);
        if (!this.spawnedBands[colIdx].has(bandTopY)) {
          this.spawnedBands[colIdx].add(bandTopY);
          em.onBandLoaded(bandTopY, vertices);
        }
        this.bridgeSpawner?.onBandLoaded(bandTopY);
        this.placeableManager?.retryPendingSpawns();
        // Same per-band-vertices-as-polygon trick as em.setPolygon above — without
        // this the interior/underside rejection test is skipped entirely, letting
        // pickups spawn on undersides / inside walls (only the angle filter ran).
        this.pickupManager?.setPolygon(vertices);
        this.pickupManager?.onBandLoaded(bandTopY, vertices);
      };

      this.walkableGroups.push(walkable);
      this.wallGroups.push(wall);
      this.edgeColliders.push(edge);
      this.chunkRenderers.push(renderer);
      this.generators.push(gen);
      this.enemyManagers.push(em);
    }

    // ── Player (gap between col 0 and col 1 — no heap there) ───────────────────
    const gapX = (this.colBounds[0][1] + this.colBounds[1][0]) / 2;
    this.spawnY = MOCK_HEAP_HEIGHT_PX - PLAYER_HEIGHT / 2 - 1;
    this.player = new Player(this, gapX, this.spawnY, this.playerConfig);
    this.player.worldWidth = INFINITE_WORLD_WIDTH;
    // Wrap when the player crosses the edge pad — a fixed margin, not a fraction
    // of the wide infinite world (which would push the wrap point ~945px off-edge).
    this.player.wrapPadX = INFINITE_EDGE_PAD;
    this.playerAnimator = new PlayerAnimator(this.player.sprite, this);
    const cosmetics = resolveCosmetics(getEquippedCosmetics(), getHatAdjustments());
    this.playerAnimator.setTieStyle({ color: cosmetics.tieColor, rainbow: cosmetics.tieRainbow });
    this.playerCosmetics = new PlayerCosmetics(this.player.sprite, this, cosmetics);
    this.playerOutro = new PlayerOutro(this, this.player.sprite);

    // ── Colliders ───────────────────────────────────────────────────────────────
    type AP = Phaser.Types.Physics.Arcade.ArcadePhysicsCallback;
    this.heapColliders = [];
    for (let i = 0; i < 3; i++) {
      this.heapColliders.push(this.physics.add.collider(this.player.sprite, this.walkableGroups[i]));
      // Walls block only on their sides (tops/undersides disabled) — slide, no eject.
      this.heapColliders.push(this.physics.add.collider(this.player.sprite, this.wallGroups[i]));
      // Safety net: push the player out horizontally if they sink into a slope's
      // (disabled) top face. See depenetratePlayerFromWall.
      this.heapColliders.push(this.physics.add.overlap(
        this.player.sprite, this.wallGroups[i],
        ((p: Phaser.GameObjects.GameObject, w: Phaser.GameObjects.GameObject) => depenetratePlayerFromWall(p, w)) as AP,
        undefined, this,
      ));
    }

    // ── Bridge spawner ──────────────────────────────────────────────────────────
    this.bridgeSpawner = new BridgeSpawner(
      this,
      this.colBounds,
      BRIDGE_DEF,
      (colIdx: number, bandTop: number) => this.colBandPolygons[colIdx].get(bandTop),
    );
    this.heapColliders.push(this.physics.add.collider(
      this.player.sprite, this.bridgeSpawner.group,
      undefined,
      (_player, _bridge) => (this.player.sprite.body as Phaser.Physics.Arcade.Body).velocity.y >= 0,
    ));
    // Side-entry slope push: left/right faces are disabled on segments so the
    // player doesn't catch on risers, but that means they clip through when
    // walking in from the side. This overlap handler corrects that by pushing
    // the player up by the penetration depth each frame they're inside a segment.
    this.physics.add.overlap(
      this.player.sprite,
      this.bridgeSpawner.group,
      (playerGO, bridgeGO) => {
        const pb = (playerGO as Phaser.Physics.Arcade.Sprite).body as Phaser.Physics.Arcade.Body;
        const sb = (bridgeGO as Phaser.Physics.Arcade.Sprite).body as Phaser.Physics.Arcade.StaticBody;
        if (pb.velocity.y < 0) return;
        const penetration = pb.bottom - sb.top;
        if (penetration > 0 && pb.top < sb.top) {
          this.bridgePenetration = Math.max(this.bridgePenetration, penetration);
        }
      },
    );

    // ── Portal manager ──────────────────────────────────────────────────────────
    this.portalManager = new PortalManager(
      this, this.player, this.colBounds, PORTAL_DEF,
      (ms) => {
        this.invincible = true;
        this.time.delayedCall(ms, () => { this.invincible = false; });
      },
      (colIdx, x, nearY) => {
        const bandTop  = Math.floor(nearY / CHUNK_BAND_HEIGHT) * CHUNK_BAND_HEIGHT;
        const vertices = this.colBandPolygons[colIdx].get(bandTop);
        if (this.debugMode) {
          const loaded = this.colBandPolygons[colIdx].size;
          console.log(`[Portal:surface] col=${colIdx} nearY=${Math.round(nearY)} bandTop=${bandTop} vertices=${vertices ? vertices.length : 'MISSING'} (${loaded} bands loaded)`);
        }
        if (!vertices || vertices.length < 2) return null;
        return findPortalSurfaceFromPolygon(vertices, bandTop, x, PORTAL_DEF.clearanceRequired);
      },
      (colIdx, bandTop) => this.colBandPolygons[colIdx].get(bandTop),
    );

    // ── Trash wall ───────────────────────────────────────────────────────────────
    AudioManager.play('music-game');
    // Cover the full wrap-padded world (matching the camera bounds), starting at the
    // left edge pad — otherwise worldX defaults to the standard-heap −SKY_PAD offset and
    // the wall is shifted left, leaving a gap on the right edge of the infinite world.
    this.trashWallManager = new TrashWallManager(this, TRASH_WALL_DEF, () => {
      this.handleDeath();
    }, INFINITE_WORLD_WIDTH + 2 * INFINITE_EDGE_PAD, MOCK_HEAP_HEIGHT_PX, -INFINITE_EDGE_PAD);
    this.trashWallManager.spawn(this.player.sprite.y);

    // ── Placeable manager ────────────────────────────────────────────────────────
    this.buffManager = new BuffManager(this, this.player);
    this.placeableManager = new PlaceableManager(
      this, this.player, this.walkableGroups, this.wallGroups,
      INFINITE_HEAP_ID,
      this.buffManager,
      true, // resnapOnLoad — heap polygons differ per run; snap saved items to nearest surface within SNAP_RADIUS
      true, // excludeCheckpoint
    );

    // No single full heap polygon exists in infinite mode (each column generates
    // forever) — heapPolygon is kept up to date per-band instead (see
    // pickupManager.setPolygon in onBandLoaded above).
    this.pickupManager = new PickupManager(this, this.player, {
      base:     this._heapParams.baseItemSpawnRate     ?? DEFAULT_HEAP_PARAMS.baseItemSpawnRate,
      positive: this._heapParams.positiveItemSpawnRate ?? DEFAULT_HEAP_PARAMS.positiveItemSpawnRate,
      negative: this._heapParams.negativeItemSpawnRate ?? DEFAULT_HEAP_PARAMS.negativeItemSpawnRate,
    });

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
      // Jumper Cables: retracted contact defeats it (reuse the stomp flow);
      // extended contact stuns the player.
      this.physics.add.overlap(
        this.player.sprite, em.group,
        this.handleStomp as unknown as AP,
        ((_p: Phaser.GameObjects.GameObject, e: Phaser.GameObjects.GameObject) =>
          this.isJumper(e) && this.isJumperVulnerable(e)) as unknown as AP,
        this,
      );
      this.physics.add.overlap(
        this.player.sprite, em.group,
        this.handleJumperStun as unknown as AP,
        ((_p: Phaser.GameObjects.GameObject, e: Phaser.GameObjects.GameObject) =>
          this.isJumper(e) && !this.isJumperVulnerable(e) && !this.invincible && !this.debugNoclip) as unknown as AP,
        this,
      );
    }

    // ── Camera ───────────────────────────────────────────────────────────────────
    // Extend the camera bounds by the wrap pad on each side (matching the wrap
    // thresholds in Player.applyWorldBoundsX, which use wrapPadX = INFINITE_EDGE_PAD).
    // Otherwise the camera clamps at the world edge while the player keeps walking
    // into the pad, so the player slides off-screen before the wrap fires. With this
    // the player reaches the screen edge exactly at the wrap point.
    CameraController.setup(
      this, this.player.sprite,
      INFINITE_WORLD_WIDTH + 2 * INFINITE_EDGE_PAD, MOCK_HEAP_HEIGHT_PX,
      -INFINITE_EDGE_PAD,
    );

    // ── HUD / score text ─────────────────────────────────────────────────────────
    this.im = InputManager.getInstance();
    this.hud = new HUD(this, this.player, {
      placeableManager: this.placeableManager,
      showDashIndicator: showDashIndicator(this.im.isMobile, getEffectiveControlMode()),
      onPause: () => this.openPauseMenu(),
    });

    const radarLevel = getUpgradeLevel('enemy_radar');
    const radarRange = ENEMY_RADAR_BASE_RANGE_PX * (1 + ENEMY_RADAR_RANGE_PER_LEVEL * radarLevel);
    this.enemyRadar = new EnemyRadar(this, radarRange);

    // Preserve ESC/P pause keybindings
    this.input.keyboard?.on('keydown-ESC', () => this.openPauseMenu());
    this.input.keyboard?.on('keydown-P',   () => this.openPauseMenu());

    this.joystick = mountJoystick(this, this.im, this.player);
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

    addToGameplayUi(this, [this.debugText, this.noclipButton]);

    // ── Background ────────────────────────────────────────────────────────────────
    new ParallaxBackground(this);

    // ── Preload ──────────────────────────────────────────────────────────────────
    // Pre-build INFINITE_PREGEN_BANDS bands per column behind a time-sliced loading
    // overlay so the opening climb has no generation hitches. Steady-state streaming
    // (INFINITE_LOOKAHEAD_CHUNKS) still tops the buffer up as the player climbs.
    this.startPreload();
  }

  // ── Preload ──────────────────────────────────────────────────────────────────

  /** Freeze the world, show the overlay, and begin time-sliced pre-generation. */
  private startPreload(): void {
    // Idempotent: drop any prior overlay so a re-entry never orphans game objects.
    this.loadingOverlay?.destroy();
    this._pregenTargetY = this.spawnY - INFINITE_PREGEN_BANDS * CHUNK_BAND_HEIGHT;
    const startBandTop  = this.layerGenerators[0].nextBandTop;
    const perColumn     = Math.max(0, Math.ceil((startBandTop - this._pregenTargetY) / CHUNK_BAND_HEIGHT));
    this._pregenTotal   = perColumn * this.layerGenerators.length;
    this._pregenDone    = 0;
    // Wall-clock start: time spent in the ESC pause menu mid-load still counts
    // toward the minimum duration, so resuming doesn't replay a fresh full ramp.
    this._preloadStartMs = performance.now();
    this._preloading    = true;
    // Pause physics so the player doesn't fall (and enemies don't drift) while the
    // buffer builds. Resumed in finishPreload(). Static-body generation is unaffected.
    this.physics.world.pause();
    this.loadingOverlay = new InfiniteLoadingOverlay(this);
    this.loadingOverlay.setProgress(0);
  }

  /** One frame of pre-generation: build bands within a time budget, update progress. */
  private tickPreload(): void {
    const BUDGET_MS = 6;
    const start = performance.now();
    let pending = true;
    do {
      pending = false;
      for (let i = 0; i < this.generators.length; i++) {
        const layerGen = this.layerGenerators[i];
        if (layerGen.nextBandTop <= this._pregenTargetY) continue;
        const { bandTop, rows } = layerGen.nextChunk();
        const polygon = simplifyPolygon(computeBandPolygon(rows), 2);
        if (rows.length >= 2 && polygon.length >= 3) {
          this.generators[i].applyBandWithRows(bandTop, rows, polygon);
        }
        this._pregenDone++;
        pending = true;
      }
    } while (pending && performance.now() - start < BUDGET_MS);

    // Drive the bar by the slower of real generation and a minimum-duration ramp,
    // and only finish once both are satisfied — so a fast load never just flashes.
    const elapsed = performance.now() - this._preloadStartMs;
    this.loadingOverlay?.setProgress(
      preloadProgress(this._pregenDone, this._pregenTotal, elapsed, INFINITE_PREGEN_MIN_MS));
    if (preloadComplete(pending, elapsed, INFINITE_PREGEN_MIN_MS)) this.finishPreload();
  }

  /** Buffer ready: drop the overlay and hand control to the player. */
  private finishPreload(): void {
    this._preloading = false;
    this.physics.world.resume();
    this.loadingOverlay?.destroy();
    this.loadingOverlay = undefined;
  }

  private openPauseMenu(): void {
    if (this.scene.isActive('PauseScene')) return;
    this.scene.launch('PauseScene', {
      gameSceneKey: this.scene.key,
      isMobile: InputManager.getInstance().isMobile,
    });
    this.scene.pause();
  }

  update(_time: number, delta: number): void {
    // While preloading, drive band generation behind the overlay and skip all
    // gameplay (physics is paused, so nothing moves anyway).
    if (this._preloading) { this.tickPreload(); return; }

    const score = Math.max(0, Math.floor(this.spawnY - this.player.sprite.y));
    if (score > 0 && this._runStartTime === null) {
      this._runStartTime = this.time.now;
      getLogger().event({ type: 'run:start', heapId: INFINITE_HEAP_ID, mode: 'infinite' });
    }
    this.hud.setScore(`${Math.floor(score / SCORE_DISPLAY_DIVISOR)} ft`);

    // ── Bridge slope correction ───────────────────────────────────────────────────
    if (this.bridgePenetration > 0) {
      const body = this.player.sprite.body as Phaser.Physics.Arcade.Body;
      body.y -= this.bridgePenetration;
      body.velocity.y = Math.min(body.velocity.y, 0);
      this.bridgePenetration = 0;
    }

    // ── Player + input ────────────────────────────────────────────────────────────
    this.joystick?.update(delta);
    this.im.update(delta, false);
    this.player.update(delta);
    this.playerAnimator.update(delta, this.player.animState);
    snapPlayerToSurface(this.player, this.edgeColliders, SURFACE_SNAP_TOLERANCE_PX);
    this.placeableManager.update();
    this.buffManager.update(delta);
    this.pickupManager.update(this.player.sprite.x, this.player.sprite.y);
    this.hud.update();

    // ── Heap generation ───────────────────────────────────────────────────────────
    // Use scrollY (+ logical viewport height) rather than cam.worldView, which is
    // only refreshed in preRender (AFTER update) and is therefore stale (≈0) on the
    // first update frame — matching the workaround in GameScene. It keeps frame-1
    // enemy visibility + lookahead generation from using y≈0, and feeds cullChunks
    // below so far-scrolled chunks are disposed rather than accumulating forever.
    const cam    = this.cameras.main;
    const camTop = cam.scrollY;
    const camBot = cam.scrollY + cam.height / cam.zoom;

    // Layer generation — dispatch bands to the worker ahead of the player every
    // frame (cheap/async), but defer the *synchronous* bake (flushWorkerResults:
    // canvas draw + collider build) until the player is grounded, so its frame
    // hitch never lands mid-jump / while moving fast. A per-column safety valve
    // force-bakes if the baked ceiling gets within GENERATION_BAKE_SAFETY_PX of
    // the player while airborne, so a long air chain can't reach un-baked heap.
    const targetY = this.player.sprite.y - INFINITE_LOOKAHEAD_CHUNKS * CHUNK_BAND_HEIGHT;
    const onGround = this.player.animState.onGround;
    const playerY  = this.player.sprite.y;
    for (let i = 0; i < 3; i++) {
      const gen      = this.generators[i];
      const layerGen = this.layerGenerators[i];
      while (layerGen.nextBandTop > targetY) {
        const { bandTop, rows } = layerGen.nextChunk();
        gen.sendLayerBatch(bandTop, rows);
      }
      if (shouldBakeBands({
        onGround,
        hasPending: gen.hasPendingResults,
        playerY,
        bakedTopY: this.chunkRenderers[i].bakedTopY,
      })) {
        gen.flushWorkerResults();
      }
    }

    // Dispose heap chunks that have scrolled far below the camera. Without this
    // the 5,000,000px climb accumulates a canvas texture + Image per band per
    // column without bound → memory pressure (lag) → eventual canvas/GL
    // allocation failure → Phaser drawing an Image whose texture source went
    // null → "Cannot read properties of null (reading 'drawImage')" crash.
    // (GameScene culls the same way every frame; Infinite must too.) Cull the
    // per-column HeapEdgeColliders alongside the renderers — their static
    // physics bodies (bandBodies backing the walkable/wall groups) leak the same
    // way otherwise, mirroring GameScene's paired cullChunks + cullBands.
    for (let i = 0; i < this.chunkRenderers.length; i++) {
      this.chunkRenderers[i].cullChunks(camBot);
      this.edgeColliders[i].cullBands(camBot, 2000);
    }

    // ── Difficulty ramp ───────────────────────────────────────────────────────────
    const elapsed = this._runStartTime !== null ? this.time.now - this._runStartTime : 0;
    const factor  = computeDifficultyFactor(score, elapsed);
    const curveMult = INFINITE_MIN_SPAWN_MULT +
      factor * (INFINITE_MAX_SPAWN_MULT - INFINITE_MIN_SPAWN_MULT);
    const spawnMult = this._heapParams.spawnRateMult * curveMult;

    for (const em of this.enemyManagers) {
      em.setSpawnRateMult(spawnMult);
      if (!this._playerDead) {
        em.update(camTop, camBot, this.player.sprite.x, this.player.sprite.y);
      }
    }

    this.enemyRadar.update(
      cam,
      this.enemyManagers.map(em => em.group),
      this.player.sprite.x,
      this.player.sprite.y,
      this.player.worldWidth + this.player.wrapPadX,
      this.pickupManager.getRadarTargets(),
    );

    // Stop advancing the delta-driven wall once dead — otherwise its kill zone
    // keeps re-firing onKill during the outro (Crash_Reports.md P1). handleDeath
    // already guards re-entry, but don't let the wall keep running regardless.
    if (!this._playerDead) {
      this.trashWallManager.update(this.player.sprite.y, delta, this.pickupManager.getWallSpeedMult() * this.buffManager.getWallSpeedMult());
      const wallGap = this.trashWallManager.currentWallY - this.player.sprite.y;
      const wallT = 1 - Math.min(1, Math.max(0, wallGap / MAX_WALL_AUDIBLE_DISTANCE));
      AudioManager.setWallProximity(wallT);
    }
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
        `Score: ${Math.floor(score / SCORE_DISPLAY_DIVISOR)} ft  elapsed: ${Math.round(elapsed / 1000)}s`,
        `Difficulty: ${factor.toFixed(2)}  spawnMult: ${spawnMult.toFixed(2)}`,
        `Enemies: ${totalEnemies}`,
      ].join('\n'));
    }
  }

  private toggleDebugMode(): void {
    this.debugMode = !this.debugMode;
    this.portalManager.debug = this.debugMode;
    this.bridgeSpawner.debug = this.debugMode;
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
    if (this._playerDead) return;
    this._playerDead = true;
    AudioManager.onPlayerDeath();
    this.player.freeze();
    this.playerAnimator.update(0, { ...this.player.animState, justDied: true });
    this.playerCosmetics.hide();
    const score      = Math.max(0, Math.floor(this.spawnY - this.player.sprite.y));
    const elapsedMs  = this._runStartTime !== null ? this.time.now - this._runStartTime : 0;
    const runResult  = buildRunScore(
      { baseHeightPx: score, kills: this._runKills, elapsedMs, salvageBonus: this.pickupManager.getCarriedBonus() },
      ENEMY_DEFS,
      true,
      this._heapParams.scoreMult,
    );

    this.playerOutro.play('death', () => {
      const killCount = Object.values(this._runKills).reduce((sum, val) => sum + val, 0);
      getLogger().event({
        type: 'run:end',
        heapId: INFINITE_HEAP_ID,
        mode: 'infinite',
        score: runResult.finalScore,
        height: score,
        kills: killCount,
        durationMs: elapsedMs,
        cause: 'death',
        upgrades: getUpgrades(),
      });
      this.scene.launch('ScoreScene', {
        score:               runResult.finalScore,
        heapId:              INFINITE_HEAP_ID,
        isPeak:              false,
        checkpointAvailable: false,
        isFailure:           true,
        baseHeightPx:        score,
        kills:               this._runKills,
        elapsedMs,
        salvageItems:        this.pickupManager.getCarriedItems(),
        heapParams: {
          ...this._heapParams,
          name: '∞ Infinite Heap',
          isInfinite: true,
        },
      });
      this.scene.sleep();
    });
  }

  // ── Enemy callbacks (same pattern as GameScene) ───────────────────────────────

  private readonly isJumper = (e: Phaser.GameObjects.GameObject): boolean =>
    (e as Phaser.GameObjects.Sprite).getData('kind') === 'jumper';

  private readonly isJumperVulnerable = (e: Phaser.GameObjects.GameObject): boolean =>
    (e as Phaser.GameObjects.Sprite).getData('vulnerable') === true;

  private readonly isStomping = (
    player: Phaser.GameObjects.GameObject,
    enemy:  Phaser.GameObjects.GameObject,
  ): boolean => {
    if (this.isJumper(enemy)) return false;
    const p = player as Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
    const e = enemy  as Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
    return p.body.velocity.y > 0 && p.body.center.y < e.body.center.y;
  };

  private readonly isDamaging = (
    player: Phaser.GameObjects.GameObject,
    enemy:  Phaser.GameObjects.GameObject,
  ): boolean =>
    !this.isJumper(enemy) && !this.invincible && !this.debugNoclip && !this.isStomping(player, enemy);

  private readonly handleStomp = (
    _player: Phaser.GameObjects.GameObject,
    enemy:   Phaser.GameObjects.GameObject,
  ): void => {
    const e    = enemy as Phaser.Physics.Arcade.Sprite;
    const kind = e.getData('kind') as EnemyKind;
    e.destroy();

    AudioManager.play('enemy-kill');
    this._runKills[kind] = (this._runKills[kind] ?? 0) + 1;
    this.player.refundAirJump();
    this.player.sprite.setVelocityY(PLAYER_JUMP_VELOCITY);

    const reward = Math.round(this.playerConfig.stompBonus * this._heapParams.coinMult);
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

    // Revive: negate this fatal hit once, with a longer invuln window so the
    // same enemy doesn't immediately re-kill. (Covers fatal hits, not wall death.)
    if (this.player.consumeRevive()) {
      this.invincible = true;
      this.time.delayedCall(PLAYER_INVINCIBLE_MS * 4, () => { this.invincible = false; });
      return;
    }

    this.handleDeath();
  };

  private readonly handleJumperStun = (
    _player: Phaser.GameObjects.GameObject,
    enemy:   Phaser.GameObjects.GameObject,
  ): void => {
    if (this.player.hasActiveShield) {
      this.player.absorbHit();
      this.invincible = true;
      this.time.delayedCall(PLAYER_INVINCIBLE_MS * 4, () => { this.invincible = false; });
      return;
    }
    if (this._playerDead || this.invincible || this.debugNoclip) return;

    const e = enemy as Phaser.Physics.Arcade.Sprite;
    const dir = Math.sign(this.player.sprite.x - e.x) || 1;
    AudioManager.play('enemy-kill');
    this.player.stun(500, { x: dir * 280, y: -180 });
    playElectrocutionEffect(this, this.player.sprite, 500);
    this.cameras.main.shake(180, 0.008);

    this.invincible = true;
    this.time.delayedCall(PLAYER_INVINCIBLE_MS, () => { this.invincible = false; });
  };

  shutdown(): void {
    // Guard against exiting mid-preload (quit-to-menu / restart): drop the overlay
    // and resume the world so we never leave a paused physics world behind.
    this.loadingOverlay?.destroy();
    this.loadingOverlay = undefined;
    this._preloading = false;
    if (this.physics.world.isPaused) this.physics.world.resume();
    this.joystick?.destroy();
    this.joystick = null;
    this.playerAnimator.destroy();
    this.playerCosmetics.destroy();
    this.playerOutro.destroy();
    AudioManager.stopAll();
  }
}
