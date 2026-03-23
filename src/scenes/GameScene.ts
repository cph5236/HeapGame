import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { HeapGenerator } from '../systems/HeapGenerator';
import { findSurfaceY } from '../systems/HeapSurface';
import { DEV_HEAP } from '../data/devHeap';
import { OBJECT_DEFS } from '../data/heapObjectDefs';
import { getPlayerConfig } from '../systems/SaveData';
import { loadHeapAdditions, persistHeapEntry } from '../systems/HeapPersistence';
import { HeapEntry } from '../data/heapTypes';
import { HUD } from '../ui/HUD';
import { InputManager } from '../systems/InputManager';
import {
  GAME_WIDTH,
  WORLD_WIDTH,
  MOCK_HEAP_HEIGHT_PX,
  GEN_LOOKAHEAD,
  HEAP_TOP_ZONE_PX,
  PLAYER_HEIGHT,
} from '../constants';

export class GameScene extends Phaser.Scene {
  private player!: Player;
  private hud!: HUD;
  private platforms!: Phaser.Physics.Arcade.StaticGroup;
  private heapGenerator!: HeapGenerator;
  private placeKey!: Phaser.Input.Keyboard.Key;
  private topZoneText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private blockPlaced: boolean = false;
  // Tracks the highest Y streamed so far (decreases as player climbs)
  private highestGeneratedY: number = 0;
  // Y at spawn — used to compute score (higher climbed = larger score)
  private spawnY: number = 0;

  constructor() {
    super({ key: 'GameScene' });
  }

  create(): void {
    this.blockPlaced = false;

    // World: Y=0 is the summit (top), Y=MOCK_HEAP_HEIGHT_PX is the base (bottom)
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, MOCK_HEAP_HEIGHT_PX);

    this.platforms = this.physics.add.staticGroup();
    this.heapGenerator = new HeapGenerator(this, this.platforms, [...DEV_HEAP, ...loadHeapAdditions()]);

    // Spawn player at world floor (left clear zone) — player climbs up through the heap
    this.spawnY = MOCK_HEAP_HEIGHT_PX - PLAYER_HEIGHT / 2 - 1;
    this.player = new Player(this, WORLD_WIDTH * 0.0625, this.spawnY, getPlayerConfig());

    // Stream an initial chunk of platforms around and above spawn
    this.highestGeneratedY = this.spawnY;
    this.generateUpTo(this.spawnY - GEN_LOOKAHEAD);

    // Collider: player lands on top of platforms
    this.physics.add.collider(this.player.sprite, this.platforms);

    // Camera: follow player, clamped to world bounds
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, MOCK_HEAP_HEIGHT_PX);
    // lerpX=1 (instant horizontal snap), lerpY=0.1 (smooth vertical follow)
    this.cameras.main.startFollow(this.player.sprite, true, 1, 0.1);

    // SPACE — place block when in top zone
    this.placeKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    // HUD: score (always visible)
    this.scoreText = this.add.text(GAME_WIDTH / 2, 30, 'Score: 0', {
      fontSize: '20px', color: '#ffffff', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20);

    // HUD: placement prompt (hidden until player reaches top zone)
    const placeHint = InputManager.getInstance().isMobile ? 'TAP \u2014 add to heap' : 'SPACE \u2014 add to heap';
    this.topZoneText = this.add.text(GAME_WIDTH / 2, 80, placeHint, {
      fontSize: '18px', color: '#ffdd44', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20).setVisible(false);

    // HUD: ability indicators (dash bar, air jumps, wall jump)
    this.hud = new HUD(this, this.player);
  }

  update(_time: number, delta: number): void {
    const im = InputManager.getInstance();
    const inTopZone = this.player.sprite.y < this.heapGenerator.topY + HEAP_TOP_ZONE_PX;
    im.update(delta, inTopZone);

    this.player.update(delta);
    this.hud.update();

    // Stream-generate platforms as player climbs upward
    const camTop = this.cameras.main.worldView.top;
    if (camTop < this.highestGeneratedY + GEN_LOOKAHEAD) {
      this.generateUpTo(camTop - GEN_LOOKAHEAD);
    }

    // Live score: pixels climbed from spawn
    const score = Math.max(0, Math.floor(this.spawnY - this.player.sprite.y));
    this.scoreText.setText(`Score: ${score}`);

    // Top-zone: show prompt and handle placement
    this.topZoneText.setVisible(inTopZone);

    if (!this.blockPlaced && inTopZone &&
        (Phaser.Input.Keyboard.JustDown(this.placeKey) || im.placeJustPressed)) {
      this.placeBlock();
    }
  }

  private generateUpTo(targetY: number): void {
    this.heapGenerator.generateUpTo(targetY);
    this.highestGeneratedY = targetY;
  }

  /**
   * Place a new block on top of the heap at the player's current X,
   * then end the run and transition to the score screen.
   */
  private placeBlock(): void {
    this.blockPlaced = true;

    const keyid = 0; // standard crate
    const def   = OBJECT_DEFS[keyid];
    const px    = this.player.sprite.x;
    const surfaceY = findSurfaceY(px, def.width, this.heapGenerator.entries);
    const y = surfaceY - def.height / 2; // no gap — matches STACK_GAP=0 in devHeap
    const entry: HeapEntry = { x: px, y, keyid };
    this.heapGenerator.addEntry(entry);
    persistHeapEntry(entry);

    const score = Math.max(0, Math.floor(this.spawnY - this.player.sprite.y));
    this.time.delayedCall(2000, () => {
      this.scene.launch('ScoreScene', { score });
    });
  }
}
