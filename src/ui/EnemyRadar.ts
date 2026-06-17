// src/ui/EnemyRadar.ts
import Phaser from 'phaser';
import { getDprCap } from '../systems/displayMetrics';
import { addToGameplayUi } from '../systems/GameplayUiCamera';
import { selectBlips, type Blip, type RadarView } from '../systems/enemyRadarMath';
import { ENEMY_RADAR_MARGIN_PX, ENEMY_RADAR_MAX_ARROWS } from '../constants';

const ARROW_KEY   = 'enemy-radar-arrow';
const ARROW_BOX   = 18; // logical px (square texture display size)
const ARROW_DEPTH = 18; // above world, below the score/pause chips (depth 19/20)

/**
 * Screen-edge arrows pointing toward nearby off-screen enemies. Lives on the
 * gameplay UI camera like the HUD. Construct once in create(); call update()
 * each frame. Decoupled from EnemyManager — reads only public Arcade groups.
 */
export class EnemyRadar {
  private readonly rangePx: number;
  private readonly arrows: Phaser.GameObjects.Image[] = [];
  // Reused across frames so gathering enemy refs allocates nothing.
  private readonly scratch: { x: number; y: number }[] = [];

  constructor(scene: Phaser.Scene, rangePx: number) {
    this.rangePx = rangePx;
    EnemyRadar.ensureTexture(scene);

    const parts: Phaser.GameObjects.GameObject[] = [];
    for (let i = 0; i < ENEMY_RADAR_MAX_ARROWS; i++) {
      const img = scene.add.image(0, 0, ARROW_KEY)
        .setScrollFactor(0)
        .setDisplaySize(ARROW_BOX, ARROW_BOX)
        .setDepth(ARROW_DEPTH)
        .setVisible(false);
      this.arrows.push(img);
      parts.push(img);
    }
    addToGameplayUi(scene, parts);
  }

  /** Bake the triangular arrow texture once, DPR-scaled (matches hudTheme). */
  private static ensureTexture(scene: Phaser.Scene): void {
    if (scene.textures.exists(ARROW_KEY)) return;
    const dpr = getDprCap();
    const s = (n: number): number => n * dpr;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    // Arrow pointing +X (rotation 0), drawn in an 18×18 logical box × dpr.
    g.fillStyle(0xff3b30, 1);          // alert red
    g.lineStyle(s(2), 0x000000, 0.9);  // dark outline for contrast over bright sky
    g.beginPath();
    g.moveTo(s(17), s(9));  // tip (right)
    g.lineTo(s(3),  s(2));  // top-left
    g.lineTo(s(7),  s(9));  // inner notch
    g.lineTo(s(3),  s(16)); // bottom-left
    g.closePath();
    g.fillPath();
    g.strokePath();
    g.generateTexture(ARROW_KEY, Math.ceil(s(ARROW_BOX)), Math.ceil(s(ARROW_BOX)));
    g.destroy();
  }

  /**
   * @param camera      the main (following) gameplay camera
   * @param enemyGroups public Arcade groups holding live enemy sprites
   * @param playerX     player world X
   * @param playerY     player world Y
   * @param wrapPeriod  horizontal wrap period (worldWidth + wrapPad)
   */
  update(
    camera: Phaser.Cameras.Scene2D.Camera,
    enemyGroups: Phaser.Physics.Arcade.Group[],
    playerX: number,
    playerY: number,
    wrapPeriod: number,
  ): void {
    // Logical visible rect from scroll + size/zoom — NOT camera.worldView, which
    // is refreshed only in preRender and is stale during update().
    const view: RadarView = {
      x: camera.scrollX,
      y: camera.scrollY,
      width: camera.width / camera.zoom,
      height: camera.height / camera.zoom,
    };

    // Gather active enemy sprite refs (sprites satisfy {x,y}; no new objects).
    this.scratch.length = 0;
    for (const group of enemyGroups) {
      const children = group.getChildren() as Phaser.GameObjects.Sprite[];
      for (const c of children) {
        if (c.active) this.scratch.push(c);
      }
    }

    const blips = selectBlips(
      this.scratch, playerX, playerY, view,
      { rangePx: this.rangePx, marginPx: ENEMY_RADAR_MARGIN_PX, wrapPeriod },
      this.arrows.length,
    );

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
}
