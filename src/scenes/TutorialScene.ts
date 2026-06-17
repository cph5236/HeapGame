import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { PlayerAnimator } from '../entities/PlayerAnimator';
import { Enemy } from '../entities/Enemy';
import { EnemyManager } from '../systems/EnemyManager';
import { PickupManager } from '../systems/PickupManager';
import { HeapGenerator } from '../systems/HeapGenerator';
import { HeapChunkRenderer } from '../systems/HeapChunkRenderer';
import { HeapEdgeCollider } from '../systems/HeapEdgeCollider';
import { CameraController } from '../systems/CameraController';
import { ParallaxBackground } from '../systems/ParallaxBackground';
import { InputManager } from '../systems/InputManager';
import { mountJoystick } from '../systems/mountJoystick';
import type { JoystickHandle } from '../systems/mountJoystick';
import {
  applyPolygonToGenerator,
  polygonTopY,
  findSurfaceYFromPolygon,
} from '../systems/HeapPolygonLoader';
import { setupGameplayUiCamera, addToGameplayUi } from '../systems/GameplayUiCamera';
import { logicalWidth, logicalHeight } from '../systems/displayMetrics';
import { getPlayerConfig, setTutorialDone, getJoystickSide } from '../systems/SaveData';
import { TutorialDirector, type TutorialStep } from '../systems/TutorialDirector';
import { TutorialOverlay } from '../ui/TutorialOverlay';
import { loadGameAssets } from './loadGameAssets';
import {
  TUTORIAL_HEAP,
  TUTORIAL_WORLD_HEIGHT,
  TUTORIAL_RAT_X,
  TUTORIAL_ITEM_X,
  TUTORIAL_STEPS,
} from '../data/tutorialFixture';
import { ENEMY_DEFS } from '../data/enemyDefs';
import { PICKUP_DEFS } from '../data/pickupDefs';
import {
  WORLD_WIDTH,
  SKY_PAD,
  PLAYER_HEIGHT,
  PLACE_HOLD_DURATION_MS,
  HUD_PLACE_W,
  HUD_PLACE_H,
  HUD_PLACE_GAP,
  SURFACE_SNAP_TOLERANCE_PX,
} from '../constants';
import { snapPlayerToSurface, depenetratePlayerFromWall } from '../systems/HeapCollisionHelpers';
import { controlClusterLayout } from '../ui/hudLogic';

export class TutorialScene extends Phaser.Scene {
  private player!: Player;
  private playerAnimator!: PlayerAnimator;
  private enemyManager!: EnemyManager;
  private pickupManager!: PickupManager;
  private heapGenerator!: HeapGenerator;
  private chunkRenderer!: HeapChunkRenderer;
  private edgeCollider!: HeapEdgeCollider;
  private heapWalkableGroup!: Phaser.Physics.Arcade.StaticGroup;
  private heapWallGroup!: Phaser.Physics.Arcade.StaticGroup;
  private joystick: JoystickHandle | null = null;
  private im!: InputManager;
  private parallaxBg!: ParallaxBackground;

  private director!: TutorialDirector;
  private overlay!: TutorialOverlay;

  private gameplayFrozen = false;
  private _ready = false;
  private spawnY: number = 0;
  private _holdElapsed = 0;
  private _prevCarried = 0;
  private placeKey!: Phaser.Input.Keyboard.Key;
  private placeBtnBg?: Phaser.GameObjects.Rectangle;
  private placeBtnLabel?: Phaser.GameObjects.Text;
  private topZoneText!: Phaser.GameObjects.Text;
  private _holdBar!: Phaser.GameObjects.Graphics;
  private _placeBtnX = 0;
  private _placeBtnY = 0;

  constructor() {
    super({ key: 'TutorialScene' });
  }

  create(): void {
    loadGameAssets(this);
    if (this.registry.get('gameAssetsReady') === true) {
      this.buildWorld();
    } else {
      this.game.events.once('gameAssetsReady', () => this.buildWorld());
    }
  }

  private buildWorld(): void {
    setupGameplayUiCamera(this);

    this.physics.world.setBounds(
      -SKY_PAD * WORLD_WIDTH,
      0,
      WORLD_WIDTH * (1 + 2 * SKY_PAD),
      TUTORIAL_WORLD_HEIGHT,
    );

    // Static groups for heap collision
    this.heapWalkableGroup = this.physics.add.staticGroup();
    this.heapWallGroup = this.physics.add.staticGroup();
    this.chunkRenderer = new HeapChunkRenderer(this);

    // Player setup
    this.spawnY = TUTORIAL_WORLD_HEIGHT - PLAYER_HEIGHT / 2 - 1;
    const playerConfig = getPlayerConfig();
    // Grant tutorial abilities on the player
    const cfg = { ...playerConfig, dash: true, dive: true, wallJump: true };
    this.player = new Player(this, WORLD_WIDTH * 0.0625, this.spawnY, cfg);

    // Collision helpers
    this.edgeCollider = new HeapEdgeCollider(cfg.maxWalkableSlopeDeg);
    this.heapGenerator = new HeapGenerator(
      this,
      this.heapWalkableGroup,
      this.heapWallGroup,
      [],
      this.chunkRenderer,
      this.edgeCollider,
    );

    // Enemy manager (with spawn rates set to 0 so onBandLoaded doesn't random-spawn)
    this.enemyManager = new EnemyManager(this, 0, 0, WORLD_WIDTH, TUTORIAL_WORLD_HEIGHT);

    // Pickup manager (with spawn rates set to 0 so onBandLoaded doesn't random-spawn)
    this.pickupManager = new PickupManager(this, this.player, {
      base: 0,
      positive: 0,
      negative: 0,
    });

    // Apply tutorial heap polygon to generators and managers
    this.enemyManager.setPolygon(TUTORIAL_HEAP);
    this.pickupManager.setPolygon(TUTORIAL_HEAP);
    applyPolygonToGenerator(TUTORIAL_HEAP, this.heapGenerator, TUTORIAL_WORLD_HEIGHT);
    this.heapGenerator.setPolygonTopY(polygonTopY(TUTORIAL_HEAP, TUTORIAL_WORLD_HEIGHT));

    // Heap colliders (copy GameScene pattern)
    this.physics.add.collider(this.player.sprite, this.heapWalkableGroup);
    this.physics.add.collider(this.player.sprite, this.heapWallGroup);
    this.physics.add.overlap(
      this.player.sprite,
      this.heapWallGroup,
      ((p: Phaser.GameObjects.GameObject, w: Phaser.GameObjects.GameObject) =>
        depenetratePlayerFromWall(p, w)) as Phaser.Types.Physics.Arcade.ArcadePhysicsCallback,
      undefined,
      this,
    );

    // Enemy overlap handlers
    type ArcadeCB = Phaser.Types.Physics.Arcade.ArcadePhysicsCallback;
    this.physics.add.overlap(
      this.player.sprite,
      this.enemyManager.group,
      this.handleStomp as unknown as ArcadeCB,
      this.isStomping as unknown as ArcadeCB,
      this,
    );

    // Player animator
    this.playerAnimator = new PlayerAnimator(this.player.sprite, this);

    // Camera setup
    CameraController.setup(
      this,
      this.player.sprite,
      WORLD_WIDTH * (1 + 2 * SKY_PAD),
      TUTORIAL_WORLD_HEIGHT,
      -SKY_PAD * WORLD_WIDTH,
    );

    // Background
    this.parallaxBg = new ParallaxBackground(this, TUTORIAL_WORLD_HEIGHT);

    // Input
    this.im = InputManager.getInstance();
    this.joystick = mountJoystick(this, this.im, this.player);
    this.placeKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    this._holdBar = this.add.graphics().setScrollFactor(0).setDepth(26);
    addToGameplayUi(this, this._holdBar);

    // PLACE button (mobile)
    if (this.im.isMobile) {
      const layout = controlClusterLayout(getJoystickSide(), logicalWidth(this), logicalHeight(this), {
        joyRadius: 50,
        joyMargin: 10,
        dashRadius: 32,
        placeW: HUD_PLACE_W,
        placeH: HUD_PLACE_H,
        placeGap: HUD_PLACE_GAP,
      });
      const px = layout.place.x;
      const py = layout.place.y;
      this._placeBtnX = px;
      this._placeBtnY = py;

      this.placeBtnBg = this.add
        .rectangle(px, py, HUD_PLACE_W, HUD_PLACE_H, 0xff9012, 0.95)
        .setScrollFactor(0)
        .setDepth(40)
        .setVisible(false)
        .setStrokeStyle(2, 0xffffff, 0.5);
      this.placeBtnBg.setInteractive({ useHandCursor: true });
      this.placeBtnBg.on('pointerdown', () => this.im.startPlace());
      this.placeBtnBg.on('pointerup', () => this.im.endPlace());
      this.placeBtnBg.on('pointerout', () => this.im.endPlace());

      this.placeBtnLabel = this.add
        .text(px, py, 'PLACE', {
          fontSize: '15px',
          color: '#241200',
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(41)
        .setVisible(false);

      this.topZoneText = this.add.text(0, 0, '').setVisible(false);
      addToGameplayUi(this, [this.placeBtnBg, this.placeBtnLabel, this.topZoneText]);
    } else {
      // Desktop PLACE hint
      this.topZoneText = this.add
        .text(logicalWidth(this) / 2, 82, 'SPACE — add to heap', {
          fontSize: '18px',
          color: '#ffdd44',
          stroke: '#000000',
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(20)
        .setVisible(false);
      addToGameplayUi(this, this.topZoneText);
    }

    // Director + overlay
    this.events.on('player-action', (kind: string) => this.director.notify(kind as any));

    this.overlay = new TutorialOverlay(this, {
      onNext: () => {
        this.unfreeze();
        this.director.tapNext();
      },
      onSkip: () => {
        this.unfreeze();
        this.director.skip();
      },
    });

    this.director = new TutorialDirector(TUTORIAL_STEPS, {
      onStepEnter: (step) => this.onStepEnter(step),
      onComplete: () => this.finish(),
    });

    this._ready = true;
    this.director.start();
  }

  private onStepEnter(step: TutorialStep): void {
    if (step.id === 'stomp') {
      this.spawnTutorialRat();
    }
    if (step.id === 'pickup') {
      this.spawnTutorialItem();
    }

    if (step.mode === 'info') {
      this.freeze();
      this.overlay.showInfo(step.message);
    } else {
      this.unfreeze();
      this.overlay.showHint(step.message);
    }
  }

  private freeze(): void {
    this.gameplayFrozen = true;
    this.im.setSuppressionRect('tutorial', {
      x: 0,
      y: 0,
      w: logicalWidth(this),
      h: logicalHeight(this),
    });
  }

  private unfreeze(): void {
    this.gameplayFrozen = false;
    this.im.setSuppressionRect('tutorial', null);
    this.im.clearBufferedActions();
  }

  private spawnTutorialRat(): void {
    const surfaceY = findSurfaceYFromPolygon(
      TUTORIAL_RAT_X,
      ENEMY_DEFS.percher.width,
      TUTORIAL_HEAP,
      TUTORIAL_WORLD_HEIGHT,
    );
    new Enemy(this, this.enemyManager.group, TUTORIAL_RAT_X, surfaceY, ENEMY_DEFS.percher);
  }

  private spawnTutorialItem(): void {
    const surfaceY = findSurfaceYFromPolygon(
      TUTORIAL_ITEM_X,
      50, // approximate pickup width for surface finding
      TUTORIAL_HEAP,
      TUTORIAL_WORLD_HEIGHT,
    );
    // Spawn a positive rarity item (spring-coil is good for tutorial)
    this.pickupManager.devForceSpawn(PICKUP_DEFS[0], 'rare', TUTORIAL_ITEM_X, surfaceY);
  }

  private readonly isStomping = (
    player: Phaser.GameObjects.GameObject,
    enemy: Phaser.GameObjects.GameObject,
  ): boolean => {
    const p = player as Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
    const e = enemy as Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
    return p.body.velocity.y > 0 && p.body.center.y < e.body.center.y;
  };

  private readonly handleStomp = (
    _player: Phaser.GameObjects.GameObject,
    enemy: Phaser.GameObjects.GameObject,
  ): void => {
    const e = enemy as Phaser.Physics.Arcade.Sprite;
    e.destroy();
    this.player.refundAirJump();
    this.player.sprite.setVelocityY(-500); // bounce
    this.director.notify('stomp');
  };

  update(_t: number, delta: number): void {
    if (!this._ready) return;

    this.joystick?.update(delta);
    const im = this.im;

    // Check if player is in live zone (top area where placement is allowed)
    const inLiveZone = this.player.sprite.y < this.heapGenerator.topY + 100;
    im.update(delta, inLiveZone);

    if (this.gameplayFrozen) {
      // Still update camera/parallax
      this.parallaxBg?.update();
      return;
    }

    // Normal gameplay updates
    this.player.update(delta);
    this.playerAnimator.update(delta, this.player.animState);
    snapPlayerToSurface(this.player, [this.edgeCollider], SURFACE_SNAP_TOLERANCE_PX);

    this.parallaxBg?.update();
    this.pickupManager.update(this.player.sprite.x, this.player.sprite.y);
    this.enemyManager.update(0, this.player.sprite.y + 5000, this.player.sprite.x, this.player.sprite.y);

    // Move detection
    if (Math.abs(this.player.sprite.body!.velocity.x) > 5) {
      this.director.notify('move');
    }

    // Pickup detection
    if (this.pickupManager.getCarriedCount() > this._prevCarried) {
      this._prevCarried = this.pickupManager.getCarriedCount();
      this.director.notify('pickup');
    }

    // Place UI logic
    const body = this.player.sprite.body as Phaser.Physics.Arcade.Body;
    const onHeapSurface = body.blocked.down;
    const inCenterZone = this.player.sprite.x >= WORLD_WIDTH * 0.125 && this.player.sprite.x <= WORLD_WIDTH * 0.875;
    const holdInputActive = im.isMobile ? im.placeHeld : this.placeKey.isDown;
    const canPlace = inLiveZone && inCenterZone && onHeapSurface;

    // Hold-to-confirm placement
    if (canPlace && holdInputActive) {
      this._holdElapsed += delta;
      if (this._holdElapsed >= PLACE_HOLD_DURATION_MS) {
        this._holdElapsed = 0;
        this.placeBlock();
      }
    } else {
      this._holdElapsed = 0;
    }

    // Show/hide PLACE button
    const showPlaceUI = inLiveZone;
    if (im.isMobile) {
      this.placeBtnBg?.setVisible(showPlaceUI);
      this.placeBtnLabel?.setVisible(showPlaceUI);
      im.setSuppressionRect(
        'place',
        showPlaceUI
          ? {
              x: this._placeBtnX - HUD_PLACE_W / 2,
              y: this._placeBtnY - HUD_PLACE_H / 2,
              w: HUD_PLACE_W,
              h: HUD_PLACE_H,
            }
          : null,
      );
    } else {
      this.topZoneText.setVisible(showPlaceUI);
    }

    // Draw hold progress bar
    const progress = this._holdElapsed / PLACE_HOLD_DURATION_MS;
    if (showPlaceUI) {
      const holdActive = canPlace && holdInputActive;
      if (im.isMobile) {
        this.placeBtnBg?.setStrokeStyle(holdActive ? 3 : 2, 0xffffff, holdActive ? 0.95 : 0.5);
        this._drawHoldBar(progress, this._placeBtnX - HUD_PLACE_W / 2, this._placeBtnY - HUD_PLACE_H / 2 - 12, HUD_PLACE_W, 6);
      } else {
        this._drawHoldBar(progress, logicalWidth(this) / 2 - 100, 97, 200, 6);
      }
    } else {
      if (im.isMobile) this.placeBtnBg?.setStrokeStyle(2, 0xffffff, 0.5);
      this._holdBar.clear();
    }
  }

  private _drawHoldBar(progress: number, x: number, y: number, w: number, h: number): void {
    this._holdBar.clear();
    if (progress <= 0) return;
    // Track
    this._holdBar.fillStyle(0x000000, 0.4);
    this._holdBar.fillRoundedRect(x, y, w, h, 4);
    // Fill
    const fillW = Math.max(0, (w - 4) * Math.min(progress, 1));
    if (fillW > 0) {
      this._holdBar.fillStyle(0xffffff, 0.8);
      this._holdBar.fillRect(x + 2, y + 2, fillW, h - 4);
    }
  }

  private placeBlock(): void {
    // In tutorial, just notify the director; no server interaction
    this.director.notify('placeBlock');
  }

  private finish(): void {
    setTutorialDone(true);
    this.overlay.hide();
    // Route into a real run
    if (this.game.registry.get('heapPolygon')) {
      this.scene.start('GameScene');
    } else if (this.game.registry.get('activeHeapId')) {
      this.game.events.once('heapCatalogReady', () => this.scene.start('GameScene'));
    } else {
      this.scene.start('MenuScene');
    }
  }

  shutdown(): void {
    this.playerAnimator.destroy();
    InputManager.getInstance().setSuppressionRect('tutorial', null);
    this.joystick?.destroy();
    this.joystick = null;
  }
}
