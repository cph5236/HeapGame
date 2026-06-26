import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { PlayerAnimator } from '../entities/PlayerAnimator';
import { PlayerOutro } from '../entities/PlayerOutro';
import { AudioManager } from '../systems/AudioManager';
import { CameraController } from '../systems/CameraController';
import { HeapGenerator } from '../systems/HeapGenerator';
import type { Vertex } from '../systems/HeapPolygon';
import { PlayGamesClient } from '../systems/PlayGamesClient';
import { getPlayConsoleId, HEIGHT_ACHIEVEMENT_THRESHOLDS_PX } from '../data/achievementDefs';
import {
  applyPolygonToGenerator,
  polygonTopY,
} from '../systems/HeapPolygonLoader';
import { getPlayerConfig, PlayerConfig, getPlaced, updatePlacedMeta, removeExpiredPlaced, getUpgrades, getEffectiveControlMode, getJoystickSide, getUpgradeLevel } from '../systems/SaveData';
import { HUD } from '../ui/HUD';
import { EnemyRadar } from '../ui/EnemyRadar';
import { showDashIndicator, controlClusterLayout } from '../ui/hudLogic';
import { InputManager } from '../systems/InputManager';
import { mountJoystick } from '../systems/mountJoystick';
import type { JoystickHandle } from '../systems/mountJoystick';
import { logicalWidth, logicalHeight } from '../systems/displayMetrics';
import { setupGameplayUiCamera, addToGameplayUi } from '../systems/GameplayUiCamera';
import { getLogger } from '../logging';
import {
  WORLD_WIDTH,
  SKY_PAD,
  MOCK_HEAP_HEIGHT_PX,
  GEN_LOOKAHEAD,
  HEAP_TOP_ZONE_PX,
  PLAYER_HEIGHT,
  PEAK_BONUS_ZONE_PX,
  PLAYER_JUMP_VELOCITY,
  PLAYER_INVINCIBLE_MS,
  PLACE_HOLD_DURATION_MS,
  SCORE_DISPLAY_DIVISOR,
  MAX_WALL_AUDIBLE_DISTANCE,
  SURFACE_SNAP_TOLERANCE_PX,
  JOYSTICK_RADIUS,
  JOYSTICK_MARGIN,
  DASH_BUTTON_RADIUS,
  HUD_PLACE_W,
  HUD_PLACE_H,
  HUD_PLACE_GAP,
  ENEMY_RADAR_BASE_RANGE_PX,
  ENEMY_RADAR_RANGE_PER_LEVEL,
} from '../constants';
import { EnemyManager } from '../systems/EnemyManager';
import { addBalance, addItem } from '../systems/SaveData';
import { ITEM_DEFS } from '../data/itemDefs';
import { HeapChunkRenderer } from '../systems/HeapChunkRenderer';
import { HeapEdgeCollider } from '../systems/HeapEdgeCollider';
import { snapPlayerToSurface, depenetratePlayerFromWall } from '../systems/HeapCollisionHelpers';
import { ParallaxBackground } from '../systems/ParallaxBackground';
import { HeapClient } from '../systems/HeapClient';
import { BuffManager } from '../systems/BuffManager';
import { PlaceableManager } from '../systems/PlaceableManager';
import { PickupManager } from '../systems/PickupManager';
import { PICKUP_DEFS } from '../data/pickupDefs';
import type { Rarity } from '../../shared/pickupScores';
import { TrashWallManager } from '../systems/TrashWallManager';
import { TRASH_WALL_DEF } from '../data/trashWallDef';
import { Enemy, type EnemyKind } from '../entities/Enemy';
import { buildRunScore } from '../systems/buildRunScore';
import { ENEMY_DEFS, DEFAULT_ENEMY_PARAMS } from '../data/enemyDefs';
import type { HeapParams } from '../../shared/heapTypes';
import { DEFAULT_HEAP_PARAMS } from '../../shared/heapTypes';

export class GameScene extends Phaser.Scene {
  private player!: Player;
  private playerAnimator!: PlayerAnimator;
  private playerOutro!: PlayerOutro;
  private hud!: HUD;
  private enemyRadar!: EnemyRadar;
  private heapWalkableGroup!: Phaser.Physics.Arcade.StaticGroup;
  private heapWallGroup!:     Phaser.Physics.Arcade.StaticGroup;
  private heapGenerator!: HeapGenerator;
  private placeKey!: Phaser.Input.Keyboard.Key;
  private topZoneText!: Phaser.GameObjects.Text;
  private placeBtnBg?: Phaser.GameObjects.Rectangle;
  private placeBtnLabel?: Phaser.GameObjects.Text;
  private blockPlaced: boolean = false;
  private highestGeneratedY: number = 0;
  private spawnY: number = 0;
  private enemyManager!: EnemyManager;
  private chunkRenderer!: HeapChunkRenderer;
  private edgeCollider!: HeapEdgeCollider;
  private invincible = false;
  private debugMode = false;
  private debugText?: Phaser.GameObjects.Text;
  private parallaxBg!: ParallaxBackground;
  private playerConfig!: PlayerConfig;
  private im!: InputManager;
  private joystick: JoystickHandle | null = null;
  private buffManager!: BuffManager;
  private placeableManager!: PlaceableManager;
  private pickupManager!: PickupManager;
  private trashWallManager!: TrashWallManager;
  private _lastScore = -1;
  private _playerDead = false;
  private _heapId = '';
  private _holdElapsed = 0;
  private _liveZoneBottomY: number | null = null;
  private _holdBar!: Phaser.GameObjects.Graphics;
  private _placeBtnX = 0;
  private _placeBtnY = 0;
  private checkpointRespawn = false;
  private _runKills:     Partial<Record<EnemyKind, number>> = {};
  private _runStartTime: number | null = null;
  private _heapParams!: HeapParams;
  private _worldHeight: number = MOCK_HEAP_HEIGHT_PX;
  private _reached100m:   boolean = false;
  private _reached1000m:  boolean = false;
  private _reachedStomp10: boolean = false;

  constructor() {
    super({ key: 'GameScene' });
  }

  init(data?: { useCheckpoint?: boolean }): void {
    this.checkpointRespawn = data?.useCheckpoint ?? false;
  }

  preload(): void {
    // Generate a plain magenta rectangle as fallback for missing enemy textures
    const g = this.make.graphics({ x: 0, y: 0, add: false } as Phaser.Types.GameObjects.Graphics.Options);
    g.fillStyle(0xff00ff);
    g.fillRect(0, 0, 36, 36);
    g.generateTexture('enemy-fallback', 36, 36);
    g.destroy();
  }

  create(): void {
    // Dedicated UI camera for the (zoomed, following) gameplay scene. Must run
    // before any HUD/world objects are created so the ADDED_TO_SCENE hook can
    // auto-ignore world objects on the UI camera. Screen-space objects are
    // registered via addToGameplayUi below.
    setupGameplayUiCamera(this);

    this.blockPlaced = false;
    this._runKills     = {};
    this._runStartTime = null;
    this._playerDead   = false;
    this._reached100m    = false;
    this._reached1000m   = false;
    this._reachedStomp10 = false;

    // World: Y=0 is the summit (top), Y=worldHeight is the base (bottom)
    this.physics.world.setBounds(-SKY_PAD * WORLD_WIDTH, 0, WORLD_WIDTH * (1 + 2 * SKY_PAD), this._worldHeight);

    this.heapWalkableGroup = this.physics.add.staticGroup();
    this.heapWallGroup     = this.physics.add.staticGroup();
    this.chunkRenderer = new HeapChunkRenderer(this);

    const polygon = (this.game.registry.get('heapPolygon') as Vertex[] | undefined) ?? [];
    const heapId = (this.game.registry.get('activeHeapId') as string | undefined) ?? '';
    this._heapId = heapId;
    this._liveZoneBottomY = HeapClient.getLiveZoneBottomY(heapId);
    this._heapParams = (this.game.registry.get('heapParams') as HeapParams | undefined) ?? DEFAULT_HEAP_PARAMS;
    this._worldHeight = this._heapParams.worldHeight ?? MOCK_HEAP_HEIGHT_PX;

    // Enemies — constructed and wired BEFORE polygon/generation calls so that
    // onBandLoaded and onPlatformSpawned fire correctly during initial load.
    this.enemyManager = new EnemyManager(this, this._heapParams.spawnRateMult, 0, WORLD_WIDTH, this._worldHeight);
    const cachedEnemyParams = HeapClient.getEnemyParams(this._heapId);
    this.enemyManager.setEnemyParams(cachedEnemyParams ?? DEFAULT_ENEMY_PARAMS);

    // Spawn player at world floor (left clear zone) — player climbs up through the heap
    this.spawnY = this._worldHeight - PLAYER_HEIGHT / 2 - 1;
    this.playerConfig = getPlayerConfig();
    this.edgeCollider = new HeapEdgeCollider(this.playerConfig.maxWalkableSlopeDeg);
    this.heapGenerator = new HeapGenerator(
      this, this.heapWalkableGroup, this.heapWallGroup, [], this.chunkRenderer, this.edgeCollider,
    );

    this.heapGenerator.onPlatformSpawned = (entry, platformTopY) => {
      this.enemyManager.onPlatformSpawned(entry.x, platformTopY, this.blockPlaced, entry);
    };

    this.heapGenerator.onBandLoaded = (bandTopY, vertices) => {
      if (!this.blockPlaced) {
        this.enemyManager.onBandLoaded(bandTopY, vertices);
        this.pickupManager?.onBandLoaded(bandTopY, vertices);
      }
    };

    // Player + salvage pickups MUST be constructed before applyPolygonToGenerator
    // below: that call eagerly fires onBandLoaded for every band of the loaded
    // heap, and the onBandLoaded callback spawns pickups via this.pickupManager.
    // If the manager doesn't exist yet, optional chaining silently drops every
    // initial surface spawn (the bug that made pickups never appear).
    this.player = new Player(this, WORLD_WIDTH * 0.0625, this.spawnY, this.playerConfig);
    this.player.worldHeight = this._worldHeight;
    this.pickupManager = new PickupManager(this, this.player, {
      base:     this._heapParams.baseItemSpawnRate     ?? DEFAULT_HEAP_PARAMS.baseItemSpawnRate,
      positive: this._heapParams.positiveItemSpawnRate ?? DEFAULT_HEAP_PARAMS.positiveItemSpawnRate,
      negative: this._heapParams.negativeItemSpawnRate ?? DEFAULT_HEAP_PARAMS.negativeItemSpawnRate,
    });

    if (polygon.length > 0) {
      this.enemyManager.setPolygon(polygon);
      this.pickupManager.setPolygon(polygon);
      applyPolygonToGenerator(polygon, this.heapGenerator, this._worldHeight);
      this.heapGenerator.setPolygonTopY(polygonTopY(polygon, this._worldHeight));
    }

    this.playerAnimator = new PlayerAnimator(this.player.sprite, this);
    this.playerOutro    = new PlayerOutro(this, this.player.sprite);

    // If restarted via checkpoint respawn, reposition player and consume one spawn
    if (this.checkpointRespawn) {
      const placed = getPlaced(this._heapId);
      const cpIdx  = placed.findIndex(p => p.id === 'checkpoint' && (p.meta?.spawnsLeft ?? 0) > 0);
      if (cpIdx !== -1) {
        const cp = placed[cpIdx];
        this.player.sprite.setPosition(cp.x, cp.y - 50);
        const newSpawns = (cp.meta?.spawnsLeft ?? 0) - 1;
        updatePlacedMeta(this._heapId, cpIdx, { spawnsLeft: newSpawns });
        if (newSpawns <= 0) removeExpiredPlaced(this._heapId);
        this.invincible = true;
        this.time.delayedCall(PLAYER_INVINCIBLE_MS * 5, () => { this.invincible = false; });
      }
    }

    AudioManager.play('music-game');
    this.trashWallManager = new TrashWallManager(this, TRASH_WALL_DEF, () => {
      // Run already ended (block placed / success outro running) — ignore a late wall kill.
      if (this._playerDead || this.blockPlaced) return;
      // Revive: lift the player above the wall surface, drop the wall back below
      // them, and continue the run instead of dying.
      if (this.player.consumeRevive()) {
        this.reviveFromWall();
        return;
      }
      this._playerDead = true;
      AudioManager.onPlayerDeath();
      this.player.freeze();
      this.playerAnimator.update(0.016, { ...this.player.animState, justDied: true });
      this.player.sprite.setDepth(4); // visually swallowed — below wall body (depth 5)

      this.playerOutro.play('death', () => {
        const checkpointAvailable = getPlaced(this._heapId).some(
          p => p.id === 'checkpoint' && (p.meta?.spawnsLeft ?? 0) > 0,
        );
        const baseHeightPx = Math.max(0, Math.floor(this.spawnY - this.player.sprite.y));
        const elapsedMs    = this._runStartTime !== null ? (this.time.now - this._runStartTime) : 0;
        const runResult    = buildRunScore(
          { baseHeightPx, kills: this._runKills, elapsedMs },
          ENEMY_DEFS,
          true,
          this._heapParams.scoreMult,
        );
        const killCount = Object.values(this._runKills).reduce((sum, val) => sum + val, 0);
        getLogger().event({
          type: 'run:end',
          heapId: this._heapId,
          mode: 'normal',
          score: runResult.finalScore,
          height: baseHeightPx,
          kills: killCount,
          durationMs: elapsedMs,
          cause: 'death',
          upgrades: getUpgrades(),
        });
        this.scene.launch('ScoreScene', {
          score:        runResult.finalScore,
          heapId:       this._heapId,
          isPeak:       false,
          checkpointAvailable,
          isFailure:    true,
          baseHeightPx,
          kills:        this._runKills,
          elapsedMs,
          heapParams:   this._heapParams,
        });
        this.scene.pause();
      });
    }, WORLD_WIDTH * (1 + 2 * SKY_PAD), this._worldHeight);
    this.trashWallManager.spawn(this.player.sprite.y);

    // Stream an initial chunk synchronously so collision is ready before the first frame
    this.highestGeneratedY = this.spawnY;
    this.generateUpTo(this.spawnY - GEN_LOOKAHEAD, true);

    // Heap colliders. Walls block only on their sides (tops/undersides are disabled in
    // HeapEdgeCollider) so the player slides down them; no eject callback needed.
    this.physics.add.collider(this.player.sprite, this.heapWalkableGroup);
    this.physics.add.collider(this.player.sprite, this.heapWallGroup);
    // Safety net: on a diagonal slope the exposed face is the slabs' (disabled) tops,
    // so falling into it can sink the player through. Push them back out horizontally.
    this.physics.add.overlap(
      this.player.sprite, this.heapWallGroup,
      ((p: Phaser.GameObjects.GameObject, w: Phaser.GameObjects.GameObject) => depenetratePlayerFromWall(p, w)) as Phaser.Types.Physics.Arcade.ArcadePhysicsCallback,
      undefined, this,
    );
    // Enemies all have allowGravity(false) and are positioned explicitly — no heap colliders needed.

    type ArcadeCB = Phaser.Types.Physics.Arcade.ArcadePhysicsCallback;
    this.physics.add.overlap(
      this.player.sprite, this.enemyManager.group,
      this.handleStomp as unknown as ArcadeCB,
      this.isStomping as unknown as ArcadeCB,
      this,
    );
    this.physics.add.overlap(
      this.player.sprite, this.enemyManager.group,
      this.handleEnemyDamage as unknown as ArcadeCB,
      this.isDamaging as unknown as ArcadeCB,
      this,
    );

    // Snap camera to player immediately so the first-frame cull threshold
    // is correct (otherwise camBottom ≈ 0 and all bottom-world chunks get culled).
    CameraController.setup(this, this.player.sprite, WORLD_WIDTH * (1 + 2 * SKY_PAD), this._worldHeight, -SKY_PAD * WORLD_WIDTH);

    // Background layers (sky colour set in main.ts; this adds ground dirt + parallax clouds)
    this.parallaxBg = new ParallaxBackground(this, this._worldHeight);

    // Debug overlay (F2 to toggle)
    this.debugText = this.add.text(8, 8, '', {
      fontSize: '13px', color: '#00ff88', stroke: '#000000', strokeThickness: 2,
    }).setScrollFactor(0).setDepth(20).setVisible(false);
    addToGameplayUi(this, this.debugText);
    this.input.keyboard!.on('keydown-F2', () => this.toggleDebugMode());
    this.input.keyboard!.on('keydown-R', () => this.placeableManager.openHotbar());

    // SPACE — place block when in top zone (desktop)
    this.placeKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    this.im = InputManager.getInstance();
    const im = this.im;
    this.joystick = mountJoystick(this, this.im, this.player);

    this._holdBar = this.add.graphics().setScrollFactor(0).setDepth(26);
    addToGameplayUi(this, this._holdBar);

    if (im.isMobile) {
      const layout = controlClusterLayout(getJoystickSide(), logicalWidth(this), logicalHeight(this), {
        joyRadius: JOYSTICK_RADIUS, joyMargin: JOYSTICK_MARGIN, dashRadius: DASH_BUTTON_RADIUS,
        placeW: HUD_PLACE_W, placeH: HUD_PLACE_H, placeGap: HUD_PLACE_GAP,
      });
      const px = layout.place.x, py = layout.place.y;
      this._placeBtnX = px;
      this._placeBtnY = py;

      this.placeBtnBg = this.add.rectangle(px, py, HUD_PLACE_W, HUD_PLACE_H, 0xff9012, 0.95)
        .setScrollFactor(0).setDepth(40).setVisible(false)
        .setStrokeStyle(2, 0xffffff, 0.5);
      this.placeBtnBg.setInteractive({ useHandCursor: true });
      this.placeBtnBg.on('pointerdown', () => im.startPlace());
      this.placeBtnBg.on('pointerup',   () => im.endPlace());
      this.placeBtnBg.on('pointerout',  () => im.endPlace());

      this.placeBtnLabel = this.add.text(px, py, 'PLACE', {
        fontSize: '15px', color: '#241200', fontStyle: 'bold',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(41).setVisible(false);

      this.topZoneText = this.add.text(0, 0, '').setVisible(false);
      addToGameplayUi(this, [this.placeBtnBg, this.placeBtnLabel, this.topZoneText]);
    } else {
      // Desktop placement hint
      this.topZoneText = this.add.text(logicalWidth(this) / 2, 82, 'SPACE \u2014 add to heap', {
        fontSize: '18px', color: '#ffdd44', stroke: '#000000', strokeThickness: 3,
      }).setOrigin(0.5).setScrollFactor(0).setDepth(20).setVisible(false);
      addToGameplayUi(this, this.topZoneText);
    }

    // PlaceableManager — items (shields, checkpoints, etc.)
    this.buffManager = new BuffManager(this, this.player);
    this.placeableManager = new PlaceableManager(this, this.player, this.heapWalkableGroup, this.heapWallGroup, this._heapId, this.buffManager);

    // HUD: ability indicators (dash bar, air jumps, wall jump), score, pause button
    this.hud = new HUD(this, this.player, {
      placeableManager: this.placeableManager,
      showDashIndicator: showDashIndicator(im.isMobile, getEffectiveControlMode()),
      onPause: () => this.openPauseMenu(),
    });

    const radarLevel = getUpgradeLevel('enemy_radar');
    const radarRange = ENEMY_RADAR_BASE_RANGE_PX * (1 + ENEMY_RADAR_RANGE_PER_LEVEL * radarLevel);
    this.enemyRadar = new EnemyRadar(this, radarRange);

    // Preserve ESC/P pause keybindings
    this.input.keyboard?.on('keydown-ESC', () => this.openPauseMenu());
    this.input.keyboard?.on('keydown-P',   () => this.openPauseMenu());

    // When the run ends we launch ScoreScene and pause this scene. Phaser's pause
    // halts update() but leaves looping sounds playing, so the trash-wall rumble and
    // enemy ambients would bleed into the score screen (the success/peak path never
    // calls onPlayerDeath()). Hush the gameplay loops once, on pause. Player one-shots
    // (e.g. player-die) and ScoreScene's own music are different categories and untouched.
    this.events.once(Phaser.Scenes.Events.PAUSE, () => {
      AudioManager.stopAll('enemySfx');
      AudioManager.stopAll('envSfx');
    });

    // Dev preview: ?dev=GameScene&params={"_devOutro":"death"} or {"_devOutro":"success"}
    // or {"_devPickup":"spring-coil"} to force-spawn a salvage pickup beside the player.
    // Optional {"_devRarity":"mythic"} sets the rolled rarity (default 'rare').
    // {"_devHotbar":"few"} seeds 3 placeables; "scroll" seeds all items so the
    // tray overflows; "empty" opens it with no items — then opens for screenshots.
    const initData = this.scene.settings.data as
      { _devOutro?: 'death' | 'success'; _devPickup?: string; _devRarity?: Rarity;
        _devDx?: number; _devDy?: number; _devHotbar?: 'few' | 'scroll' | 'empty';
        _devRadarFixture?: boolean } | undefined;
    if (initData?._devHotbar) {
      const seed = initData._devHotbar === 'scroll' ? ITEM_DEFS
        : initData._devHotbar === 'empty' ? []
        : ITEM_DEFS.filter(d => d.category === 'placeable');
      seed.forEach((d, i) => addItem(d.id, i + 1));
      this.placeableManager.openHotbar();
    }
    if (initData?._devPickup) {
      const def = PICKUP_DEFS.find(d => d.id === initData._devPickup) ?? PICKUP_DEFS[0];
      const rarity = initData._devRarity ?? 'rare';
      const dx = initData._devDx ?? 40;   // >72 places it out of overlay range (glow-only)
      const dy = initData._devDy ?? 0;
      this.pickupManager.devForceSpawn(def, rarity, this.player.sprite.x + dx, this.spawnY + PLAYER_HEIGHT / 2 + dy);
    }
    if (initData?._devRadarFixture) {
      const px = this.player.sprite.x;
      const py = this.player.sprite.y;
      // Fixed off-screen positions: above, below, far right, and the OPPOSITE
      // world edge (exercises the wrap arrow). new Enemy adds itself to the group.
      const spots = [
        { x: px,             y: py - 400 },              // above
        { x: px,             y: py + 400 },              // below
        { x: px + 450,       y: py },                    // far right (off-screen)
        { x: WORLD_WIDTH - 20, y: py },                  // opposite edge → wrap arrow
      ];
      for (const s of spots) {
        new Enemy(this, this.enemyManager.group, s.x, s.y, ENEMY_DEFS.percher);
      }
      // Off-screen pickups (left + up-right) exercise the blue salvage arrows.
      const pdef = PICKUP_DEFS[0];
      this.pickupManager.devForceSpawn(pdef, 'rare', px - 450, py);
      this.pickupManager.devForceSpawn(pdef, 'rare', px + 300, py - 350);
    }
    if (initData?._devOutro) {
      const kind = initData._devOutro;
      this._playerDead = true;
      this.player.freeze();
      this.physics.world.pause();
      this.time.delayedCall(500, () => {
        this.playerAnimator.update(0.016, {
          ...this.player.animState,
          ...(kind === 'death' ? { justDied: true } : { justPlaced: true }),
        });
        this.playerOutro.play(kind, () => {
          // dev preview: do not launch ScoreScene
        });
      });
    }
  }

  update(_time: number, delta: number): void {
    const im = this.im;
    const inLiveZone = this._liveZoneBottomY !== null
      ? this.player.sprite.y <= this._liveZoneBottomY
      : this.player.sprite.y < this.heapGenerator.topY + HEAP_TOP_ZONE_PX;
    this.joystick?.update(delta);
    im.update(delta, inLiveZone);

    this.player.update(delta);
    this.playerAnimator.update(delta, this.player.animState);
    snapPlayerToSurface(this.player, [this.edgeCollider], SURFACE_SNAP_TOLERANCE_PX);

    // After a wrap, snap the camera so the player appears at the edge they came out of,
    // then tween the follow offset back to zero so the camera re-centers naturally.
    if (this.player.wrapDir !== 0) {
      const halfW = this.cameras.main.worldView.width / 2;
      // wrapDir -1 = came out right edge, offset pulls camera left so player is at right
      // wrapDir  1 = came out left edge,  offset pulls camera right so player is at left
      const startOffset = -this.player.wrapDir * halfW;
      this.cameras.main.setFollowOffset(startOffset, 0);
      this.tweens.killTweensOf(this.cameras.main);
      this.tweens.addCounter({
        from: startOffset, to: 0, duration: 2000, ease: 'Cubic.Out',
        onUpdate: (tween) => {
          this.cameras.main.setFollowOffset(tween.getValue() ?? 0, 0);
        },
      });
    }

    this.parallaxBg.update();
    this.hud.update();
    this.placeableManager.update();
    this.pickupManager.update(this.player.sprite.x, this.player.sprite.y);
    this.buffManager.update(delta);

    const cam       = this.cameras.main;
    const camTop    = cam.scrollY;
    // Visible world bottom = scrollY + viewport-height-in-world-units. We compute
    // it from scrollY + cam.height/zoom rather than cam.worldView.bottom because
    // worldView is only refreshed in preRender (AFTER update): on the very first
    // update frame it is still stale (≈0), so a worldView-based cull threshold
    // would wipe every chunk baked during create() — and GameScene's pre-built
    // heap is rendered once and never regenerates, so the heap silhouette would
    // vanish for the whole run. scrollY is set immediately by centerOn, so this
    // form is correct from frame 1 and still DPR-correct (cam.height is physical).
    const camBottom = cam.scrollY + cam.height / cam.zoom;

    // Stop advancing the wall once the run has ended (death or block placed).
    // The wall is delta-driven, so physics.world.pause() in the outro does NOT
    // halt it — left running, its kill zone re-fires onKill mid-outro and reaches
    // PlayerOutro.play() a second time (Crash_Reports.md P1). Mirror the enemy gate.
    if (!this._playerDead && !this.blockPlaced) {
      this.trashWallManager.update(this.player.sprite.y, delta, this.pickupManager.getWallSpeedMult() * this.buffManager.getWallSpeedMult());
    }
    if (!this._playerDead) {
      const wallGap = this.trashWallManager.currentWallY - this.player.sprite.y;
      const wallT = 1 - Math.min(1, Math.max(0, wallGap / MAX_WALL_AUDIBLE_DISTANCE));
      AudioManager.setWallProximity(wallT);
    }
    if (!this._playerDead) {
      this.enemyManager.update(camTop, camBottom, this.player.sprite.x, this.player.sprite.y);
    }
    this.enemyRadar.update(
      cam,
      [this.enemyManager.group],
      this.player.sprite.x,
      this.player.sprite.y,
      this.player.worldWidth + this.player.wrapPadX,
      this.pickupManager.getRadarTargets(),
    );
    this.chunkRenderer.cullChunks(camBottom);
    this.edgeCollider.cullBands(camBottom, 2000);

    // Flush any worker results from the previous frame into Phaser objects
    this.heapGenerator.flushWorkerResults();

    // Stream-generate platforms as player climbs upward (async via worker)
    if (camTop < this.highestGeneratedY + GEN_LOOKAHEAD) {
      this.generateUpTo(camTop - GEN_LOOKAHEAD);
    }

    // Debug coord overlay
    if (this.debugMode && this.debugText) {
      const px = Math.round(this.player.sprite.x);
      const py = Math.round(this.player.sprite.y);
      this.debugText.setText(
        `Player: (${px}, ${py})\nCam scroll: (${Math.round(cam.scrollX)}, ${Math.round(cam.scrollY)})`,
      );
    }

    // Height achievements. Thresholds live in achievementDefs and are derived
    // from displayed feet via SCORE_DISPLAY_DIVISOR, so the unlock point always
    // matches the number the player sees on the HUD. (Hardcoded px previously
    // assumed a 1000px/m scale that doesn't exist in-game, putting both
    // thresholds above the climbable height of a heap so neither could fire.)
    const currentHeightPx = Math.max(0, Math.floor(this.spawnY - this.player.sprite.y));
    if (!this._reached100m && currentHeightPx >= HEIGHT_ACHIEVEMENT_THRESHOLDS_PX.reach_100m) {
      this._reached100m = true;
      const id = getPlayConsoleId('reach_100m');
      if (id) PlayGamesClient.unlockAchievement(id);
    }
    if (!this._reached1000m && currentHeightPx >= HEIGHT_ACHIEVEMENT_THRESHOLDS_PX.reach_1000m) {
      this._reached1000m = true;
      const id = getPlayConsoleId('reach_1000m');
      if (id) PlayGamesClient.unlockAchievement(id);
    }

    // Live score: pixels climbed from spawn
    const score = Math.max(0, Math.floor(this.spawnY - this.player.sprite.y));
    if (score > 0 && this._runStartTime === null) {
      this._runStartTime = this.time.now;
      getLogger().event({ type: 'run:start', heapId: this._heapId, mode: 'normal' });
    }
    if (score !== this._lastScore) {
      this._lastScore = score;
      const ft = Math.floor(score / SCORE_DISPLAY_DIVISOR);
      this.hud.setScore(`${ft} ft`);
    }

    // Top zone UI
    const showPlaceUI = inLiveZone && !this.blockPlaced;
    if (im.isMobile) {
      this.placeBtnBg?.setVisible(showPlaceUI);
      this.placeBtnLabel?.setVisible(showPlaceUI);
      // Register/clear the PLACE button's screen zone so tapping it never jumps.
      im.setSuppressionRect(
        'place',
        showPlaceUI
          ? { x: this._placeBtnX - HUD_PLACE_W / 2, y: this._placeBtnY - HUD_PLACE_H / 2, w: HUD_PLACE_W, h: HUD_PLACE_H }
          : null,
      );
    } else {
      this.topZoneText.setVisible(showPlaceUI);
    }

    // Hold-to-confirm placement
    const body = this.player.sprite.body as Phaser.Physics.Arcade.Body;
    const onHeapSurface = body.blocked.down;
    const inCenterZone  = this.player.sprite.x >= WORLD_WIDTH * 0.125 &&
                          this.player.sprite.x <= WORLD_WIDTH * 0.875;
    const holdInputActive = im.isMobile ? im.placeHeld : this.placeKey.isDown;
    const canPlace = !this.blockPlaced && inLiveZone && inCenterZone && onHeapSurface;

    if (canPlace && holdInputActive) {
      this._holdElapsed += delta;
      if (this._holdElapsed >= PLACE_HOLD_DURATION_MS) {
        this._holdElapsed = 0;
        this.placeBlock();
      }
    } else {
      this._holdElapsed = 0;
    }

    // Progress bar + button highlight
    const progress = this._holdElapsed / PLACE_HOLD_DURATION_MS;
    if (showPlaceUI) {
      const holdActive = canPlace && holdInputActive;
      if (im.isMobile) {
        this.placeBtnBg?.setStrokeStyle(holdActive ? 3 : 2, 0xffffff, holdActive ? 0.95 : 0.5);
        // Hold bar just above the PLACE button
        this._drawHoldBar(progress, this._placeBtnX - HUD_PLACE_W / 2, this._placeBtnY - HUD_PLACE_H / 2 - 12, HUD_PLACE_W, 6);
      } else {
        // Bar anchored below topZoneText at (logicalWidth/2, 82)
        this._drawHoldBar(progress, logicalWidth(this) / 2 - 100, 97, 200, 6);
      }
    } else {
      if (im.isMobile) this.placeBtnBg?.setStrokeStyle(2, 0xffffff, 0.5);
      this._holdBar.clear();
    }
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  /**
   * Draws a hold-progress bar. Track is a dark rounded rect; fill is a white
   * inset rect that grows left-to-right. Clears when progress <= 0.
   */
  private _drawHoldBar(progress: number, x: number, y: number, w: number, h: number): void {
    this._holdBar.clear();
    if (progress <= 0) return;
    // Track
    this._holdBar.fillStyle(0x000000, 0.4);
    this._holdBar.fillRoundedRect(x, y, w, h, 4);
    // Fill — straight rect inset 2px so it sits inside the rounded track
    const fillW = Math.max(0, (w - 4) * Math.min(progress, 1));
    if (fillW > 0) {
      this._holdBar.fillStyle(0xffffff, 0.8);
      this._holdBar.fillRect(x + 2, y + 2, fillW, h - 4);
    }
  }

  private toggleDebugMode(): void {
    this.debugMode = !this.debugMode;
    this.debugText?.setVisible(this.debugMode);
    if (this.debugMode) {
      this.physics.world.createDebugGraphic();
      this.physics.world.drawDebug = true;
    } else {
      this.physics.world.debugGraphic?.destroy();
      this.physics.world.drawDebug = false;
    }
  }

  private generateUpTo(targetY: number, forceSync = false): void {
    if (forceSync) {
      this.heapGenerator.generateUpToSync(targetY);
    } else {
      this.heapGenerator.generateUpTo(targetY);
    }
    this.highestGeneratedY = targetY;
  }

  private placeBlock(): void {
    // Run already ended (died this frame) — don't start a success outro on top of it.
    if (this._playerDead || this.blockPlaced) return;
    this.blockPlaced = true;

    const px     = this.player.sprite.x;
    const py     = this.player.sprite.y;
    const isPeak = py <= this.heapGenerator.topY + PEAK_BONUS_ZONE_PX;

    let bonusCoinsFromServer = 0;
    const appendDone = HeapClient.append(this._heapId, px, py).then(placeResp => {
      bonusCoinsFromServer = placeResp?.bonusCoins ?? 0;
      return HeapClient.load(this._heapId);
    }).then(freshPolygon => {
      applyPolygonToGenerator(freshPolygon, this.heapGenerator);
      this.heapGenerator.setPolygonTopY(polygonTopY(freshPolygon));
      this.game.registry.set('heapPolygon', freshPolygon);
      this._liveZoneBottomY = HeapClient.getLiveZoneBottomY(this._heapId);
    });

    const baseHeightPx = Math.max(0, Math.floor(this.spawnY - py));
    const elapsedMs    = this._runStartTime !== null ? (this.time.now - this._runStartTime) : 0;
    const runResult    = buildRunScore(
      { baseHeightPx, kills: this._runKills, elapsedMs, salvageBonus: this.pickupManager.getCarriedBonus() },
      ENEMY_DEFS,
      false,
      this._heapParams.scoreMult,
    );
    this.player.freeze();
    this.playerAnimator.update(0.016, { ...this.player.animState, justPlaced: true });

    this.time.delayedCall(500, () => {
      this.playerOutro.play('success', () => {
        void appendDone.then(() => {
          const killCount = Object.values(this._runKills).reduce((sum, val) => sum + val, 0);
          getLogger().event({
            type: 'run:end',
            heapId: this._heapId,
            mode: 'normal',
            score: runResult.finalScore,
            height: baseHeightPx,
            kills: killCount,
            durationMs: elapsedMs,
            cause: 'quit',
            upgrades: getUpgrades(),
          });
          this.scene.launch('ScoreScene', {
            score:        runResult.finalScore,
            heapId:       this._heapId,
            isPeak,
            baseHeightPx,
            kills:          this._runKills,
            elapsedMs,
            salvageItems: this.pickupManager.getCarriedItems(),
            heapParams:     this._heapParams,
            bonusCoins:     bonusCoinsFromServer,
          });
          this.scene.pause();
        });
      });
    });
  }

  // ── Enemies ──────────────────────────────────────────────────────────────────

  private readonly isStomping = (
    player: Phaser.GameObjects.GameObject,
    enemy: Phaser.GameObjects.GameObject,
  ): boolean => {
    const p = player as Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
    const e = enemy as Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
    return p.body.velocity.y > 0 && p.body.center.y < e.body.center.y;
  };

  private readonly isDamaging = (
    player: Phaser.GameObjects.GameObject,
    enemy: Phaser.GameObjects.GameObject,
  ): boolean => {
    return !this.invincible && !this.isStomping(player, enemy);
  };

  private readonly handleStomp = (
    _player: Phaser.GameObjects.GameObject,
    enemy: Phaser.GameObjects.GameObject,
  ): void => {
    const e = enemy as Phaser.Physics.Arcade.Sprite;
    AudioManager.play('enemy-kill');
    const stompX = e.x;
    const stompY = e.y;
    const kind = e.getData('kind') as EnemyKind;
    e.destroy();

    this._runKills[kind] = (this._runKills[kind] ?? 0) + 1;

    // Stomp achievements
    const totalKills = Object.values(this._runKills).reduce((sum, n) => sum + n, 0);
    if (!this._reachedStomp10 && totalKills >= 10) {
      this._reachedStomp10 = true;
      const id = getPlayConsoleId('stomp_10');
      if (id) PlayGamesClient.unlockAchievement(id);
    }
    const incrId = getPlayConsoleId('stomp_100_total');
    if (incrId) PlayGamesClient.incrementAchievement(incrId, 1);

    this.player.refundAirJump();
    this.player.sprite.setVelocityY(PLAYER_JUMP_VELOCITY);
    const stompReward = Math.round(this.playerConfig.stompBonus * this._heapParams.coinMult);
    addBalance(stompReward);

    const marker = this.add.text(stompX, stompY - 16, `+${stompReward}`, {
      fontSize: '22px', color: '#ffdd44',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(50);
    this.tweens.add({
      targets: marker,
      y: stompY - 80,
      alpha: 0,
      duration: 2000,
      ease: 'Cubic.Out',
      onComplete: () => marker.destroy(),
    });

    this.invincible = true;
    this.time.delayedCall(PLAYER_INVINCIBLE_MS, () => { this.invincible = false; });
  };

  private readonly handleEnemyDamage = (): void => {
    // Shield absorbs the hit
    if (this.player.hasActiveShield) {
      this.player.absorbHit();
      this.invincible = true;
      this.time.delayedCall(PLAYER_INVINCIBLE_MS * 4, () => { this.invincible = false; });
      return;
    }

    // Revive: negate this fatal hit once, with a longer invuln window so the
    // same enemy doesn't immediately re-kill.
    if (this.player.consumeRevive()) {
      this.grantReviveInvuln();
      this.triggerReviveCue();
      return;
    }

    if (this._playerDead || this.blockPlaced) return;
    this._playerDead = true;
    AudioManager.onPlayerDeath();
    this.player.freeze();
    this.playerAnimator.update(0.016, { ...this.player.animState, justDied: true });

    this.time.delayedCall(500, () => {
      this.playerOutro.play('death', () => {
        const checkpointAvailable = getPlaced(this._heapId).some(
          p => p.id === 'checkpoint' && (p.meta?.spawnsLeft ?? 0) > 0,
        );
        const baseHeightPx = Math.max(0, Math.floor(this.spawnY - this.player.sprite.y));
        const elapsedMs    = this._runStartTime !== null ? (this.time.now - this._runStartTime) : 0;
        const runResult    = buildRunScore(
          { baseHeightPx, kills: this._runKills, elapsedMs },
          ENEMY_DEFS,
          true,
          this._heapParams.scoreMult,
        );
        const killCount = Object.values(this._runKills).reduce((sum, val) => sum + val, 0);
        getLogger().event({
          type: 'run:end',
          heapId: this._heapId,
          mode: 'normal',
          score: runResult.finalScore,
          height: baseHeightPx,
          kills: killCount,
          durationMs: elapsedMs,
          cause: 'death',
          upgrades: getUpgrades(),
        });
        this.scene.launch('ScoreScene', {
          score:        runResult.finalScore,
          heapId:       this._heapId,
          isPeak:       false,
          checkpointAvailable,
          isFailure:    true,
          baseHeightPx,
          kills:        this._runKills,
          elapsedMs,
          heapParams:   this._heapParams,
        });
        this.scene.pause();
      });
    });
  };

  /** Lift the player clear of the trash wall and resume the run (Revive consumed). */
  private reviveFromWall(): void {
    const REVIVE_WALL_LIFT = 220; // px above the wall surface to drop the player
    const safeY = this.trashWallManager.currentWallY - REVIVE_WALL_LIFT;
    this.player.sprite.setPosition(this.player.sprite.x, safeY);
    this.player.sprite.setVelocity(0, 0);
    this.trashWallManager.revive(safeY);
    this.grantReviveInvuln();
    this.triggerReviveCue();
  }

  /** Brief invulnerability window after a Revive so the player isn't instantly re-killed. */
  private grantReviveInvuln(): void {
    this.invincible = true;
    this.time.delayedCall(PLAYER_INVINCIBLE_MS * 4, () => { this.invincible = false; });
  }

  /** One-shot visual cue when a Revive triggers. */
  private triggerReviveCue(): void {
    this.cameras.main.flash(300, 120, 40, 70);
    const txt = this.add.text(logicalWidth(this) / 2, logicalHeight(this) / 2 - 40, 'REVIVED!', {
      fontSize: '40px', color: '#ff6688', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 6,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(50);
    addToGameplayUi(this, txt);
    this.tweens.add({
      targets: txt,
      alpha:  { from: 1, to: 0 },
      y:      txt.y - 50,
      scale:  { from: 0.6, to: 1.2 },
      duration: 900, ease: 'Cubic.Out',
      onComplete: () => txt.destroy(),
    });
  }

  private openPauseMenu(): void {
    if (this.scene.isActive('PauseScene')) return; // guard against double-open
    this.scene.launch('PauseScene', {
      gameSceneKey: this.scene.key,
      isMobile: InputManager.getInstance().isMobile,
    });
    this.scene.pause();
  }

  shutdown(): void {
    this.playerAnimator.destroy();
    this.playerOutro.destroy();
    AudioManager.stopAll();
    // InputManager is a singleton — drop our PLACE suppression zone so it can't
    // linger into the next scene.
    InputManager.getInstance().setSuppressionRect('place', null);
    this.joystick?.destroy();
    this.joystick = null;
  }
}
