import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { HeapGenerator } from '../systems/HeapGenerator';
import { findSurfaceY } from '../systems/HeapSurface';
import { DEV_HEAP } from '../data/devHeap';
import { OBJECT_DEFS, HEAP_ITEM_COUNT } from '../data/heapObjectDefs';
import { getPlayerConfig } from '../systems/SaveData';
import { loadHeapAdditions, persistHeapEntry } from '../systems/HeapPersistence';
import { HeapEntry } from '../data/heapTypes';
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
} from '../constants';
import { EnemyManager } from '../systems/EnemyManager';
import { addBalance } from '../systems/SaveData';
import { HeapChunkRenderer } from '../systems/HeapChunkRenderer';
import { HeapEdgeCollider } from '../systems/HeapEdgeCollider';

export class GameScene extends Phaser.Scene {
  private player!: Player;
  private hud!: HUD;
  private platforms!: Phaser.Physics.Arcade.StaticGroup;
  private heapGenerator!: HeapGenerator;
  private placeKey!: Phaser.Input.Keyboard.Key;
  private topZoneText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private placementGhost!: Phaser.GameObjects.Graphics;
  private flashText!: Phaser.GameObjects.Text;
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

  constructor() {
    super({ key: 'GameScene' });
  }

  create(): void {
    this.blockPlaced = false;
    this.infoOpen = false;
    this.infoOverlayParts = [];

    // World: Y=0 is the summit (top), Y=MOCK_HEAP_HEIGHT_PX is the base (bottom)
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, MOCK_HEAP_HEIGHT_PX);

    this.platforms = this.physics.add.staticGroup();
    this.chunkRenderer = new HeapChunkRenderer(this);
    this.edgeCollider = new HeapEdgeCollider(this);
    this.heapGenerator = new HeapGenerator(this, this.platforms, [...DEV_HEAP, ...loadHeapAdditions()], this.chunkRenderer, this.edgeCollider);

    // Spawn player at world floor (left clear zone) — player climbs up through the heap
    this.spawnY = MOCK_HEAP_HEIGHT_PX - PLAYER_HEIGHT / 2 - 1;
    this.player = new Player(this, WORLD_WIDTH * 0.0625, this.spawnY, getPlayerConfig());

    // Stream an initial chunk of platforms around and above spawn
    this.highestGeneratedY = this.spawnY;
    this.generateUpTo(this.spawnY - GEN_LOOKAHEAD);

    // Collider: player lands on top of platforms
    this.physics.add.collider(this.player.sprite, this.platforms);

    // Enemies
    this.enemyManager = new EnemyManager(this, () => this.heapGenerator.entries);

    this.heapGenerator.onPlatformSpawned = (entry, platformTopY) => {
      this.enemyManager.onPlatformSpawned(entry, platformTopY, this.blockPlaced);
    };

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

    // Debug overlay (F2 to toggle)
    this.debugText = this.add.text(8, 8, '', {
      fontSize: '13px', color: '#00ff88', stroke: '#000000', strokeThickness: 2,
    }).setScrollFactor(0).setDepth(20).setVisible(false);
    this.input.keyboard!.on('keydown-F2', () => this.toggleDebugMode());

    // SPACE — place block when in top zone (desktop)
    this.placeKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    // Placement ghost (world-space, scrolls with camera)
    this.placementGhost = this.add.graphics().setDepth(15);

    const im = InputManager.getInstance();

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
      this.placeBtnBg.on('pointerup', () => im.triggerPlace());

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

    // Flash message for invalid placement attempts
    this.flashText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, '', {
      fontSize: '22px', color: '#ff6666',
      stroke: '#000000', strokeThickness: 3,
      backgroundColor: '#000000aa',
      padding: { x: 14, y: 8 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(30).setVisible(false);

    // HUD: ability indicators (dash bar, air jumps, wall jump)
    this.hud = new HUD(this, this.player);

    // Info button (ⓘ) — top-right corner
    this.createInfoButton(im.isMobile);
  }

  update(_time: number, delta: number): void {
    const im = InputManager.getInstance();
    const inTopZone = this.player.sprite.y < this.heapGenerator.topY + HEAP_TOP_ZONE_PX;
    im.update(delta, inTopZone);

    this.player.update(delta);
    this.hud.update();

    const cam       = this.cameras.main;
    const camTop    = cam.scrollY;
    const camBottom = cam.scrollY + cam.height;

    this.enemyManager.update(camTop, camBottom);
    this.chunkRenderer.cullChunks(camBottom);
    this.edgeCollider.cullBands(camBottom, 2000);

    // Stream-generate platforms as player climbs upward
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
    this.scoreText.setText(`Score: ${score}`);

    // Top zone UI
    const showPlaceUI = inTopZone && !this.blockPlaced;
    if (im.isMobile) {
      this.placeBtnBg?.setVisible(showPlaceUI);
      this.placeBtnLabel?.setVisible(showPlaceUI);
    } else {
      this.topZoneText.setVisible(showPlaceUI);
    }

    // Placement ghost preview
    this.updatePlacementGhost(inTopZone);

    // Placement trigger
    if (!this.blockPlaced && inTopZone &&
        (Phaser.Input.Keyboard.JustDown(this.placeKey) || im.placeJustPressed)) {
      this.placeBlock();
    }
  }

  // ── Private ─────────────────────────────────────────────────────────────────

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

  private generateUpTo(targetY: number): void {
    this.heapGenerator.generateUpTo(targetY);
    this.highestGeneratedY = targetY;
  }

  private updatePlacementGhost(inTopZone: boolean): void {
    this.placementGhost.clear();
    if (!inTopZone || this.blockPlaced) return;

    const def      = OBJECT_DEFS[0];
    const px       = this.player.sprite.x;
    const surfaceY = findSurfaceY(px, def.width, this.heapGenerator.entries);
    if (surfaceY >= MOCK_HEAP_HEIGHT_PX) return; // no surface below — hide ghost

    const minX  = WORLD_WIDTH * 0.125 + def.width / 2;
    const maxX  = WORLD_WIDTH * 0.875 - def.width / 2;
    const valid = px >= minX && px <= maxX;

    const ghostY = surfaceY - def.height / 2;

    if (valid) {
      this.placementGhost.fillStyle(0x44aaff, 0.45);
      this.placementGhost.lineStyle(2, 0x88ccff, 0.9);
    } else {
      this.placementGhost.fillStyle(0xff4444, 0.35);
      this.placementGhost.lineStyle(2, 0xff8888, 0.8);
    }
    this.placementGhost.fillRect(px - def.width / 2, ghostY - def.height / 2, def.width, def.height);
    this.placementGhost.strokeRect(px - def.width / 2, ghostY - def.height / 2, def.width, def.height);
  }

  private placeBlock(): void {
    this.blockPlaced = true;

    const keyid    = Phaser.Math.Between(0, HEAP_ITEM_COUNT - 1);
    const def      = OBJECT_DEFS[keyid];
    const px       = this.player.sprite.x;
    const surfaceY = findSurfaceY(px, def.width, this.heapGenerator.entries);

    // Validate: must have a real surface to stack on
    if (surfaceY >= MOCK_HEAP_HEIGHT_PX) {
      this.blockPlaced = false;
      this.showFlash('No surface here!');
      return;
    }

    // Validate: must be in center 75% of the world (matches dev heap placement rules)
    const minX = WORLD_WIDTH * 0.125 + def.width / 2;
    const maxX = WORLD_WIDTH * 0.875 - def.width / 2;
    if (px < minX || px > maxX) {
      this.blockPlaced = false;
      this.showFlash('Move to the center area!');
      return;
    }

    const isPeak = this.player.sprite.y <= this.heapGenerator.topY + PEAK_BONUS_ZONE_PX;

    const y = surfaceY - def.height / 2;
    const entry: HeapEntry = { x: px, y, keyid };
    this.heapGenerator.addEntry(entry);
    persistHeapEntry(entry);

    const score = Math.max(0, Math.floor(this.spawnY - surfaceY));
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
    return p.body.velocity.y > 0 && (p.y + p.height / 2) <= (e.y + 4);
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
    addBalance(25);

    const marker = this.add.text(stompX, stompY - 16, '+25', {
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
    const score = Math.max(0, Math.floor(this.spawnY - this.player.sprite.y));
    this.scene.launch('ScoreScene', { score, isPeak: false });
    this.scene.pause();
  };

  private showFlash(message: string): void {
    this.flashText.setText(message).setVisible(true);
    this.time.delayedCall(1500, () => this.flashText.setVisible(false));
  }

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
