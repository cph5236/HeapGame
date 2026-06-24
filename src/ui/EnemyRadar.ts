// src/ui/EnemyRadar.ts
import Phaser from 'phaser';
import { getDprCap } from '../systems/displayMetrics';
import { addToGameplayUi } from '../systems/GameplayUiCamera';
import { selectBlips, type Blip, type RadarView, type RadarOpts } from '../systems/enemyRadarMath';
import { ENEMY_RADAR_MARGIN_PX, ENEMY_RADAR_MAX_ARROWS } from '../constants';

const ARROW_BOX   = 18; // logical px (square texture display size)
const ARROW_DEPTH = 30; // above the HUD chips (score/pause/revive sit at depth 19–21)

// One colour-coded channel per target kind. Red points at threats, blue at salvage.
const ENEMY_ARROW_KEY    = 'radar-arrow-enemy';
const PICKUP_ARROW_KEY   = 'radar-arrow-pickup';
const ENEMY_ARROW_COLOR  = 0xff3b30; // alert red
const PICKUP_ARROW_COLOR = 0x32b6ff; // salvage blue

/** Shared empty target list so the optional `pickups` arg allocates nothing. */
const NO_TARGETS: readonly { x: number; y: number }[] = [];

/**
 * One colour-coded set of screen-edge arrows: a DPR-baked triangular texture plus
 * a fixed pool of Images. Reused every frame — render() never allocates.
 */
class RadarChannel {
  private readonly arrows: Phaser.GameObjects.Image[] = [];

  constructor(scene: Phaser.Scene, texKey: string, color: number, maxArrows: number) {
    RadarChannel.ensureTexture(scene, texKey, color);
    const parts: Phaser.GameObjects.GameObject[] = [];
    for (let i = 0; i < maxArrows; i++) {
      const img = scene.add.image(0, 0, texKey)
        .setScrollFactor(0)
        .setDisplaySize(ARROW_BOX, ARROW_BOX)
        .setDepth(ARROW_DEPTH)
        .setVisible(false);
      this.arrows.push(img);
      parts.push(img);
    }
    addToGameplayUi(scene, parts);
  }

  /** Arrow-pool size — caps how many blips this channel can show at once. */
  get capacity(): number { return this.arrows.length; }

  /** Position/rotate/show one arrow per blip; hide the unused slots. */
  render(blips: Blip[]): void {
    for (let i = 0; i < this.arrows.length; i++) {
      const arrow = this.arrows[i];
      const blip = blips[i] as Blip | undefined;
      if (blip) {
        arrow.setPosition(blip.x, blip.y).setRotation(blip.angle).setVisible(true);
      } else {
        arrow.setVisible(false);
      }
    }
  }

  /** Bake the triangular arrow texture once, DPR-scaled (matches hudTheme). */
  private static ensureTexture(scene: Phaser.Scene, texKey: string, color: number): void {
    if (scene.textures.exists(texKey)) return;
    const dpr = getDprCap();
    const s = (n: number): number => n * dpr;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    // Arrow pointing +X (rotation 0), drawn in an 18×18 logical box × dpr.
    g.fillStyle(color, 1);
    g.lineStyle(s(2), 0x000000, 0.9);  // dark outline for contrast over bright sky
    g.beginPath();
    g.moveTo(s(17), s(9));  // tip (right)
    g.lineTo(s(3),  s(2));  // top-left
    g.lineTo(s(7),  s(9));  // inner notch
    g.lineTo(s(3),  s(16)); // bottom-left
    g.closePath();
    g.fillPath();
    g.strokePath();
    g.generateTexture(texKey, Math.ceil(s(ARROW_BOX)), Math.ceil(s(ARROW_BOX)));
    g.destroy();
  }
}

/**
 * Screen-edge arrows pointing toward nearby off-screen targets. Lives on the
 * gameplay UI camera like the HUD. Construct once in create(); call update()
 * each frame. Two colour channels: red for enemies (threats), blue for pickups
 * (salvage). Decoupled from EnemyManager/PickupManager — reads only the public
 * Arcade groups / position lists the caller passes in.
 */
export class EnemyRadar {
  private readonly rangePx: number;
  private readonly enemyChannel:  RadarChannel;
  private readonly pickupChannel: RadarChannel;
  // Reused across frames so gathering enemy refs allocates nothing.
  private readonly enemyScratch: { x: number; y: number }[] = [];

  constructor(scene: Phaser.Scene, rangePx: number) {
    this.rangePx = rangePx;
    this.enemyChannel  = new RadarChannel(scene, ENEMY_ARROW_KEY,  ENEMY_ARROW_COLOR,  ENEMY_RADAR_MAX_ARROWS);
    this.pickupChannel = new RadarChannel(scene, PICKUP_ARROW_KEY, PICKUP_ARROW_COLOR, ENEMY_RADAR_MAX_ARROWS);
  }

  /**
   * @param camera      the main (following) gameplay camera
   * @param enemyGroups public Arcade groups holding live enemy sprites
   * @param playerX     player world X
   * @param playerY     player world Y
   * @param wrapPeriod  horizontal wrap period (worldWidth + wrapPad)
   * @param pickups     live positions of collectible pickups (omit if the mode has none)
   */
  update(
    camera: Phaser.Cameras.Scene2D.Camera,
    enemyGroups: Phaser.Physics.Arcade.Group[],
    playerX: number,
    playerY: number,
    wrapPeriod: number,
    pickups: readonly { x: number; y: number }[] = NO_TARGETS,
  ): void {
    // Logical visible rect from scroll + size/zoom — NOT camera.worldView, which
    // is refreshed only in preRender and is stale during update().
    const view: RadarView = {
      x: camera.scrollX,
      y: camera.scrollY,
      width: camera.width / camera.zoom,
      height: camera.height / camera.zoom,
    };
    const opts: RadarOpts = { rangePx: this.rangePx, marginPx: ENEMY_RADAR_MARGIN_PX, wrapPeriod };

    // Enemies: gather active sprite refs (sprites satisfy {x,y}; no new objects).
    this.enemyScratch.length = 0;
    for (const group of enemyGroups) {
      const children = group.getChildren() as Phaser.GameObjects.Sprite[];
      for (const c of children) {
        if (c.active) this.enemyScratch.push(c);
      }
    }
    this.enemyChannel.render(
      selectBlips(this.enemyScratch, playerX, playerY, view, opts, this.enemyChannel.capacity),
    );

    // Pickups: the caller passes a live position list (already {x,y}); no gather needed.
    this.pickupChannel.render(
      selectBlips(pickups, playerX, playerY, view, opts, this.pickupChannel.capacity),
    );
  }
}
