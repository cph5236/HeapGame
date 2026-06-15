import Phaser from 'phaser';
import {
  WORLD_WIDTH,
  SKY_PAD,
  MOCK_HEAP_HEIGHT_PX,
  CLOUD_POOL_SIZE,
  CLOUD_PARALLAX_FACTOR,
  CLOUD_START_WORLD_Y,
} from '../constants';
import {
  ensureCloudTexture,
  CLOUD_TEXTURE_KEY,
  CLOUD_TEX_W,
  CLOUD_TEX_H,
  CLOUD_TEX_OFFSET_X,
  CLOUD_TEX_OFFSET_Y,
} from './backgroundEntities';
import { logicalWidth, logicalHeight } from './displayMetrics';

interface Cloud {
  sprite: Phaser.GameObjects.Image;
  virtualX: number; // screen-space X
  virtualY: number; // screen-space Y
  scale: number;
}

const GROUND_DEPTH = 0;
const CLOUD_DEPTH  = 1;

export class ParallaxBackground {
  private readonly scene: Phaser.Scene;
  private readonly worldHeight: number;
  private readonly clouds: Cloud[] = [];
  private prevScrollY = 0;
  private prevScrollX = 0;

  constructor(scene: Phaser.Scene, worldHeight: number = MOCK_HEAP_HEIGHT_PX) {
    this.scene = scene;
    this.worldHeight = worldHeight;
    this.createGroundLayer();
    this.createCloudPool();
    // Initialise to current camera position so the first update() has delta ≈ 0.
    this.prevScrollY = scene.cameras.main.scrollY;
    this.prevScrollX = scene.cameras.main.scrollX;
  }

  update(): void {
    const cam = this.scene.cameras.main;
    const dy = cam.scrollY - this.prevScrollY;
    const dx = cam.scrollX - this.prevScrollX;
    this.prevScrollY = cam.scrollY;
    this.prevScrollX = cam.scrollX;
    this.updateClouds(dx, dy, cam.scrollY);
  }

  // ── Ground ──────────────────────────────────────────────────────────────────

  private createGroundLayer(): void {
    // Static art — bake once into a texture and draw as a single Image so the
    // 5 fillRect/strokeRect ops don't run through GraphicsWebGLRenderer per frame.
    const GROUND_TEX_KEY = 'ground-layer';
    const STRIP_HEIGHT   = 14 + 36 + 70 + 60; // 180

    const fullW  = Math.round(WORLD_WIDTH * (1 + 2 * SKY_PAD));
    const startX = -SKY_PAD * WORLD_WIDTH;

    if (!this.scene.textures.exists(GROUND_TEX_KEY)) {
      const g = this.scene.make.graphics({ x: 0, y: 0 }, false);
      // Texture local-Y 0 corresponds to (floorY - 14): top of the grass strip.
      const localFloorY = 14;

      g.fillStyle(0x4a7c3f).fillRect(0, 0, fullW, 14);
      g.fillStyle(0x7a4f2d).fillRect(0, localFloorY, fullW, 36);
      g.fillStyle(0x5a3820).fillRect(0, localFloorY + 36, fullW, 70);
      g.fillStyle(0x3a2510).fillRect(0, localFloorY + 106, fullW, 60);
      g.lineStyle(2, 0x2a1a08, 0.6).strokeRect(0, localFloorY, fullW, 1);

      g.generateTexture(GROUND_TEX_KEY, fullW, STRIP_HEIGHT);
      g.destroy();
    }

    const floorY = this.worldHeight;
    this.scene.add
      .image(startX, floorY - 14, GROUND_TEX_KEY)
      .setOrigin(0, 0)
      .setDepth(GROUND_DEPTH);
  }

  // ── Clouds ──────────────────────────────────────────────────────────────────

  private createCloudPool(): void {
    ensureCloudTexture(this.scene);

    // Origin chosen so the sprite's anchor matches the original Graphics local
    // (0, 0) — i.e. setPosition(virtualX, virtualY) renders identically to before.
    const originX = CLOUD_TEX_OFFSET_X / CLOUD_TEX_W;
    const originY = CLOUD_TEX_OFFSET_Y / CLOUD_TEX_H;

    for (let i = 0; i < CLOUD_POOL_SIZE; i++) {
      const scale = Phaser.Math.FloatBetween(0.6, 1.4);
      const virtualX = Phaser.Math.Between(-80, logicalWidth(this.scene) + 80);
      const virtualY = Phaser.Math.Between(-logicalHeight(this.scene), logicalHeight(this.scene));

      const sprite = this.scene.add
        .image(virtualX, virtualY, CLOUD_TEXTURE_KEY)
        .setOrigin(originX, originY)
        .setDepth(CLOUD_DEPTH)
        .setScrollFactor(0)
        .setScale(scale);

      this.clouds.push({ sprite, virtualX, virtualY, scale });
    }
  }

  private updateClouds(dx: number, dy: number, scrollY: number): void {
    // Hide clouds when the player is below the cloud-start altitude.
    // scrollY + logicalHeight(this.scene) is the world Y of the camera bottom edge.
    const inCloudZone = scrollY + logicalHeight(this.scene) <= CLOUD_START_WORLD_Y;

    for (const cloud of this.clouds) {
      if (!inCloudZone) {
        cloud.sprite.setVisible(false);
        continue;
      }
      cloud.sprite.setVisible(true);

      // When camera moves up (dy < 0, climbing), -dy is positive,
      // so virtualY increases → cloud drifts downward on screen at (1-FACTOR) speed.
      const clampedDx = Math.max(-20, Math.min(20, dx));
      cloud.virtualX += -clampedDx * 0.05;
      cloud.virtualY += -dy * (1 - CLOUD_PARALLAX_FACTOR);

      // Recycle: drifted below screen bottom
      if (cloud.virtualY > logicalHeight(this.scene) + 200) {
        cloud.virtualX = Phaser.Math.Between(-60, logicalWidth(this.scene) + 60);
        cloud.virtualY = Phaser.Math.Between(-300, -80);
      }

      // Recycle: drifted above screen top (player fell fast)
      if (cloud.virtualY < -400) {
        cloud.virtualX = Phaser.Math.Between(-60, logicalWidth(this.scene) + 60);
        cloud.virtualY = logicalHeight(this.scene) + Phaser.Math.Between(20, 200);
      }

      cloud.sprite.setPosition(cloud.virtualX, cloud.virtualY);
    }
  }
}
