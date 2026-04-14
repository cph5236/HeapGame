import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { HeapGenerator } from '../systems/HeapGenerator';
import type { Vertex } from '../systems/HeapPolygon';
import {
  applyPolygonToGenerator,
  polygonTopY,
} from '../systems/HeapPolygonLoader';
import { getPlayerConfig, PlayerConfig, getPlaced, updatePlacedMeta, removeExpiredPlaced } from '../systems/SaveData';
import { HUD } from '../ui/HUD';
import { InputManager } from '../systems/InputManager';
import {
  GAME_WIDTH,
  GAME_HEIGHT,
  WORLD_WIDTH,
  MOCK_HEAP_HEIGHT_PX,
  GEN_LOOKAHEAD,
  HEAP_TOP_ZONE_PX,
  PLAYER_HEIGHT,
  PEAK_BONUS_ZONE_PX,
  PLAYER_JUMP_VELOCITY,
  PLAYER_INVINCIBLE_MS,
  PLACE_HOLD_DURATION_MS,
} from '../constants';
import { EnemyManager } from '../systems/EnemyManager';
import { addBalance } from '../systems/SaveData';
import { HeapChunkRenderer } from '../systems/HeapChunkRenderer';
import { HeapEdgeCollider } from '../systems/HeapEdgeCollider';
import { ParallaxBackground } from '../systems/ParallaxBackground';
import { HeapClient } from '../systems/HeapClient';
import { PlaceableManager } from '../systems/PlaceableManager';
import { TrashWallManager } from '../systems/TrashWallManager';
import { TRASH_WALL_DEF } from '../data/trashWallDef';

export class GameScene extends Phaser.Scene {
  private player!: Player;
  private hud!: HUD;
  private heapWalkableGroup!: Phaser.Physics.Arcade.StaticGroup;
  private heapWallGroup!:     Phaser.Physics.Arcade.StaticGroup;
  private heapGenerator!: HeapGenerator;
  private placeKey!: Phaser.Input.Keyboard.Key;
  private topZoneText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private placeBtnBg?: Phaser.GameObjects.Rectangle;
  private placeBtnLabel?: Phaser.GameObjects.Text;
  private infoOverlayParts: (Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text)[] = [];
  private infoOpen = false;
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
  private placeableManager!: PlaceableManager;
  private trashWallManager!: TrashWallManager;
  private _lastScore = -1;
  private _heapId = '';
  private _holdElapsed = 0;
  private _holdBar!: Phaser.GameObjects.Graphics;
  private checkpointRespawn = false;

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
    this.blockPlaced = false;
    this.infoOpen = false;
    this.infoOverlayParts = [];

    // World: Y=0 is the summit (top), Y=MOCK_HEAP_HEIGHT_PX is the base (bottom)
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, MOCK_HEAP_HEIGHT_PX);

    this.heapWalkableGroup = this.physics.add.staticGroup();
    this.heapWallGroup     = this.physics.add.staticGroup();
    this.chunkRenderer = new HeapChunkRenderer(this);

    const polygon = (this.game.registry.get('heapPolygon') as Vertex[] | undefined) ?? [];
    const heapId = (this.game.registry.get('heapId') as string | undefined) ?? '';
    this._heapId = heapId;

    // Enemies — constructed and wired BEFORE polygon/generation calls so that
    // onBandLoaded and onPlatformSpawned fire correctly during initial load.
    this.enemyManager = new EnemyManager(this);

    // Spawn player at world floor (left clear zone) — player climbs up through the heap
    this.spawnY = MOCK_HEAP_HEIGHT_PX - PLAYER_HEIGHT / 2 - 1;
    this.playerConfig = getPlayerConfig();
    this.edgeCollider = new HeapEdgeCollider(this, this.playerConfig.maxWalkableSlopeDeg);
    this.heapGenerator = new HeapGenerator(
      this, this.heapWalkableGroup, this.heapWallGroup, [], this.chunkRenderer, this.edgeCollider,
    );

    this.heapGenerator.onPlatformSpawned = (entry, platformTopY) => {
      this.enemyManager.onPlatformSpawned(entry.x, platformTopY, this.blockPlaced, entry);
    };

    this.heapGenerator.onBandLoaded = (bandTopY, vertices) => {
      if (!this.blockPlaced) {
        this.enemyManager.onBandLoaded(bandTopY, vertices);
      }
    };

    if (polygon.length > 0) {
      this.enemyManager.setPolygon(polygon);
      applyPolygonToGenerator(polygon, this.heapGenerator);
      this.heapGenerator.setPolygonTopY(polygonTopY(polygon));
    }

    this.player = new Player(this, WORLD_WIDTH * 0.0625, this.spawnY, this.playerConfig);

    // If restarted via checkpoint respawn, reposition player and consume one spawn
    if (this.checkpointRespawn) {
      const placed = getPlaced();
      const cpIdx  = placed.findIndex(p => p.id === 'checkpoint' && (p.meta?.spawnsLeft ?? 0) > 0);
      if (cpIdx !== -1) {
        const cp = placed[cpIdx];
        this.player.sprite.setPosition(cp.x, cp.y - 50);
        const newSpawns = (cp.meta?.spawnsLeft ?? 0) - 1;
        updatePlacedMeta(cpIdx, { spawnsLeft: newSpawns });
        if (newSpawns <= 0) removeExpiredPlaced();
        this.invincible = true;
        this.time.delayedCall(PLAYER_INVINCIBLE_MS * 5, () => { this.invincible = false; });
      }
    }

    this.trashWallManager = new TrashWallManager(this, TRASH_WALL_DEF, () => {
      this.player.freeze();
      this.player.sprite.setDepth(4); // visually swallowed — below wall body (depth 5)
      this.time.delayedCall(800, () => {
        const checkpointAvailable = getPlaced().some(
          p => p.id === 'checkpoint' && (p.meta?.spawnsLeft ?? 0) > 0,
        );
        const score = Math.max(0, Math.floor(this.spawnY - this.player.sprite.y));
        this.scene.launch('ScoreScene', { score, isPeak: false, checkpointAvailable, isFailure: true });
        this.scene.pause();
      });
    });
    this.trashWallManager.spawn(this.player.sprite.y);

    // Stream an initial chunk synchronously so collision is ready before the first frame
    this.highestGeneratedY = this.spawnY;
    this.generateUpTo(this.spawnY - GEN_LOOKAHEAD, true);

    // Heap colliders — walkable surfaces resolve normally; wall surfaces use callback to prevent resting
    type ArcadeProcess = Phaser.Types.Physics.Arcade.ArcadePhysicsCallback;
    this.physics.add.collider(this.player.sprite, this.heapWalkableGroup);
    this.physics.add.collider(
      this.player.sprite, this.heapWallGroup,
      this.onHeapWallCollide as unknown as ArcadeProcess, undefined, this,
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

    // Camera: follow player, clamped to world bounds
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, MOCK_HEAP_HEIGHT_PX);
    this.cameras.main.startFollow(this.player.sprite, true, 1, 0.1);
    // Snap camera to player immediately so the first-frame cull threshold
    // is correct (otherwise camBottom ≈ 0 and all bottom-world chunks get culled).
    this.cameras.main.centerOn(this.player.sprite.x, this.player.sprite.y);

    // Background layers (sky colour set in main.ts; this adds ground dirt + parallax clouds)
    this.parallaxBg = new ParallaxBackground(this);

    // Debug overlay (F2 to toggle)
    this.debugText = this.add.text(8, 8, '', {
      fontSize: '13px', color: '#00ff88', stroke: '#000000', strokeThickness: 2,
    }).setScrollFactor(0).setDepth(20).setVisible(false);
    this.input.keyboard!.on('keydown-F2', () => this.toggleDebugMode());
    this.input.keyboard!.on('keydown-R', () => this.placeableManager.openHotbar());

    // SPACE — place block when in top zone (desktop)
    this.placeKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    this.im = InputManager.getInstance();
    const im = this.im;

    this._holdBar = this.add.graphics().setScrollFactor(0).setDepth(26);

    // HUD: score (always visible)
    this.scoreText = this.add.text(GAME_WIDTH / 2, 30, 'Score: 0', {
      fontSize: '20px', color: '#ffffff', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20);

    if (im.isMobile) {
      // Mobile placement button — replaces the text hint, appears in top zone
      this.placeBtnBg = this.add.rectangle(GAME_WIDTH / 2, 82, 280, 56, 0x1155aa, 0.88)
        .setScrollFactor(0).setDepth(24).setVisible(false)
        .setStrokeStyle(2, 0x4488dd);
      this.placeBtnBg.setInteractive({ useHandCursor: true });
      this.placeBtnBg.on('pointerdown', () => im.startPlace());
      this.placeBtnBg.on('pointerup', () => im.endPlace());
      this.placeBtnBg.on('pointerout', () => im.endPlace());

      this.placeBtnLabel = this.add.text(GAME_WIDTH / 2, 82, 'PLACE BLOCK', {
        fontSize: '22px', color: '#ffffff', fontStyle: 'bold',
        stroke: '#000000', strokeThickness: 3,
      }).setOrigin(0.5).setScrollFactor(0).setDepth(25).setVisible(false);

      // Dummy topZoneText (not shown on mobile)
      this.topZoneText = this.add.text(0, 0, '').setVisible(false);
    } else {
      // Desktop placement hint
      this.topZoneText = this.add.text(GAME_WIDTH / 2, 82, 'SPACE \u2014 add to heap', {
        fontSize: '18px', color: '#ffdd44', stroke: '#000000', strokeThickness: 3,
      }).setOrigin(0.5).setScrollFactor(0).setDepth(20).setVisible(false);
    }

    // PlaceableManager — items (shields, checkpoints, etc.)
    this.placeableManager = new PlaceableManager(this, this.player, this.heapWalkableGroup, this.heapWallGroup);

    // HUD: ability indicators (dash bar, air jumps, wall jump)
    this.hud = new HUD(this, this.player, this.placeableManager);

    // Info button (ⓘ) — top-right corner
    this.createInfoButton(im.isMobile);
  }

  update(_time: number, delta: number): void {
    const im = this.im;
    const inTopZone = this.player.sprite.y < this.heapGenerator.topY + HEAP_TOP_ZONE_PX;
    im.update(delta, inTopZone);

    this.player.update(delta);
    this.parallaxBg.update();
    this.hud.update();
    this.placeableManager.update();

    const cam       = this.cameras.main;
    const camTop    = cam.scrollY;
    const camBottom = cam.scrollY + cam.height;

    this.trashWallManager.update(this.player.sprite.y, delta);
    this.enemyManager.update(camTop, camBottom);
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

    // Live score: pixels climbed from spawn
    const score = Math.max(0, Math.floor(this.spawnY - this.player.sprite.y));
    if (score !== this._lastScore) {
      this._lastScore = score;
      this.scoreText.setText(`Score: ${score}`);
    }

    // Top zone UI
    const showPlaceUI = inTopZone && !this.blockPlaced;
    if (im.isMobile) {
      this.placeBtnBg?.setVisible(showPlaceUI);
      this.placeBtnLabel?.setVisible(showPlaceUI);
    } else {
      this.topZoneText.setVisible(showPlaceUI);
    }

    // Hold-to-confirm placement
    const body = this.player.sprite.body as Phaser.Physics.Arcade.Body;
    const onHeapSurface = body.blocked.down;
    const inCenterZone  = this.player.sprite.x >= WORLD_WIDTH * 0.125 &&
                          this.player.sprite.x <= WORLD_WIDTH * 0.875;
    const holdInputActive = im.isMobile ? im.placeHeld : this.placeKey.isDown;
    const canPlace = !this.blockPlaced && inTopZone && inCenterZone && onHeapSurface;

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
        this.placeBtnBg?.setStrokeStyle(2, holdActive ? 0x88ddff : 0x4488dd);
        // Bar anchored to bottom of button: center=(GAME_WIDTH/2, 82), size=(280, 56)
        this._drawHoldBar(progress, GAME_WIDTH / 2 - 134, 96, 268, 8);
      } else {
        // Bar anchored below topZoneText at (GAME_WIDTH/2, 82)
        this._drawHoldBar(progress, GAME_WIDTH / 2 - 100, 97, 200, 6);
      }
    } else {
      if (im.isMobile) this.placeBtnBg?.setStrokeStyle(2, 0x4488dd);
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
    this.blockPlaced = true;

    const px     = this.player.sprite.x;
    const py     = this.player.sprite.y;
    const isPeak = py <= this.heapGenerator.topY + PEAK_BONUS_ZONE_PX;

    void HeapClient.append(this._heapId, px, py).then(() =>
      HeapClient.load(this._heapId),
    ).then(freshPolygon => {
      applyPolygonToGenerator(freshPolygon, this.heapGenerator);
      this.heapGenerator.setPolygonTopY(polygonTopY(freshPolygon));
      this.game.registry.set('heapPolygon', freshPolygon);
    });

    const score = Math.max(0, Math.floor(this.spawnY - py));
    this.time.delayedCall(2000, () => {
      this.scene.launch('ScoreScene', { score, isPeak });
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
    const stompX = e.x;
    const stompY = e.y;
    e.destroy();

    this.player.sprite.setVelocityY(PLAYER_JUMP_VELOCITY);
    const stompReward = this.playerConfig.stompBonus;
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

  /**
   * Process callback for player vs heapWallGroup collisions.
   * Returning true lets the collision resolve (wall blocks horizontal movement).
   * When the player somehow lands on the top of a wall slab (body.blocked.down),
   * a small downward + lateral nudge slides them off so they cannot stand there.
   */
  private readonly onHeapWallCollide = (
    playerObj: Phaser.GameObjects.GameObject,
  ): void => {
    const body = (playerObj as Phaser.Types.Physics.Arcade.SpriteWithDynamicBody).body;
    if (body.blocked.down) {
      this.player.inSlopeZone = true;
    }
  };

  private readonly handleEnemyDamage = (): void => {
    // Shield absorbs the hit
    if (this.player.hasActiveShield) {
      this.player.absorbHit();
      this.invincible = true;
      this.time.delayedCall(PLAYER_INVINCIBLE_MS * 4, () => { this.invincible = false; });
      return;
    }

    const checkpointAvailable = getPlaced().some(
      p => p.id === 'checkpoint' && (p.meta?.spawnsLeft ?? 0) > 0,
    );
    const score = Math.max(0, Math.floor(this.spawnY - this.player.sprite.y));
    this.scene.launch('ScoreScene', { score, isPeak: false, checkpointAvailable, isFailure: true });
    this.scene.pause();
  };

  private createInfoButton(isMobile: boolean): void {
    const bx = GAME_WIDTH - 22;
    const by = 22;

    // Circle background
    const btnGfx = this.add.graphics().setScrollFactor(0).setDepth(26);
    btnGfx.fillStyle(0x000000, 0.65);
    btnGfx.fillCircle(bx, by, 14);
    btnGfx.lineStyle(2, 0x8899bb, 1);
    btnGfx.strokeCircle(bx, by, 14);

    // "i" label
    this.add.text(bx, by, 'i', {
      fontSize: '16px', color: '#ddddff', fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(27);

    // Invisible interactive hit zone
    const hitZone = this.add.zone(bx, by, 36, 36).setScrollFactor(0).setDepth(27);
    hitZone.setInteractive({ useHandCursor: true });
    hitZone.on('pointerup', () => this.toggleInfoOverlay());

    // Overlay background (full-screen dim)
    const overlayBg = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.72)
      .setScrollFactor(0).setDepth(28).setVisible(false).setInteractive();
    overlayBg.on('pointerup', () => this.toggleInfoOverlay());

    // Panel
    const panel = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 380, 300, 0x0d0d20)
      .setScrollFactor(0).setDepth(29).setVisible(false)
      .setStrokeStyle(2, 0x4455aa);

    // Controls text
    const lines = isMobile ? [
      'CONTROLS',
      '',
      'Move     Tilt phone left / right',
      'Jump     Tap screen',
      'Dash     Swipe horizontally',
      'Place    PLACE BLOCK button',
      '',
      'TIP',
      '',
      'Left & right edges wrap around!',
    ] : [
      'CONTROLS',
      '',
      'Move     \u2190 \u2192  /  A  D',
      'Jump     \u2191  /  W',
      'Dash     SHIFT',
      'Place    SPACE',
      '',
      'TIP',
      '',
      'Left & right edges wrap around!',
    ];

    const overlayText = this.add.text(GAME_WIDTH / 2 - 160, GAME_HEIGHT / 2 - 120, lines.join('\n'), {
      fontSize: '17px', color: '#ccccdd',
      stroke: '#000000', strokeThickness: 1,
      lineSpacing: 5,
    }).setScrollFactor(0).setDepth(30).setVisible(false);

    this.infoOverlayParts = [overlayBg, panel, overlayText as Phaser.GameObjects.Text];
  }

  private toggleInfoOverlay(): void {
    this.infoOpen = !this.infoOpen;
    for (const part of this.infoOverlayParts) {
      part.setVisible(this.infoOpen);
    }
  }
}
