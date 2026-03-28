import Phaser from 'phaser';
import {
  GAME_WIDTH,
  GAME_HEIGHT,
  WORLD_WIDTH,
  MOCK_HEAP_HEIGHT_PX,
  CLOUD_POOL_SIZE,
  CLOUD_PARALLAX_FACTOR,
  CLOUD_START_WORLD_Y,
} from '../constants';

interface Cloud {
  gfx: Phaser.GameObjects.Graphics;
  virtualX: number; // screen-space X
  virtualY: number; // screen-space Y
  scale: number;
}

const GROUND_DEPTH = 0;
const CLOUD_DEPTH  = 1;

export class ParallaxBackground {
  private readonly scene: Phaser.Scene;
  private readonly clouds: Cloud[] = [];
  private prevScrollY = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.createGroundLayer();
    this.createCloudPool();
    // Initialise to current camera position so the first update() has delta ≈ 0.
    this.prevScrollY = scene.cameras.main.scrollY;
  }

  update(): void {
    const cam = this.scene.cameras.main;
    const dy = cam.scrollY - this.prevScrollY; // negative when climbing (camera scrolls up)
    this.prevScrollY = cam.scrollY;
    this.updateClouds(dy, cam.scrollY);
  }

  // ── Ground ──────────────────────────────────────────────────────────────────

  private createGroundLayer(): void {
    const gfx    = this.scene.add.graphics().setDepth(GROUND_DEPTH);
    const floorY = MOCK_HEAP_HEIGHT_PX;

    // Grass strip — sits above the world floor, visible beside the heap base
    gfx.fillStyle(0x4a7c3f).fillRect(0, floorY - 14, WORLD_WIDTH, 14);

    // Topsoil
    gfx.fillStyle(0x7a4f2d).fillRect(0, floorY, WORLD_WIDTH, 36);

    // Sub-soil
    gfx.fillStyle(0x5a3820).fillRect(0, floorY + 36, WORLD_WIDTH, 70);

    // Deep ground
    gfx.fillStyle(0x3a2510).fillRect(0, floorY + 106, WORLD_WIDTH, 60);

    // Thin definition line at the grass/topsoil boundary
    gfx.lineStyle(2, 0x2a1a08, 0.6).strokeRect(0, floorY, WORLD_WIDTH, 1);
  }

  // ── Clouds ──────────────────────────────────────────────────────────────────

  private createCloudPool(): void {
    for (let i = 0; i < CLOUD_POOL_SIZE; i++) {
      const gfx   = this.scene.add.graphics().setDepth(CLOUD_DEPTH).setScrollFactor(0);
      const scale = Phaser.Math.FloatBetween(0.6, 1.4);

      const cloud: Cloud = {
        gfx,
        virtualX: Phaser.Math.Between(-80, GAME_WIDTH + 80),
        virtualY: Phaser.Math.Between(-GAME_HEIGHT, GAME_HEIGHT),
        scale,
      };

      this.drawCloud(cloud);
      cloud.gfx.setPosition(cloud.virtualX, cloud.virtualY);
      this.clouds.push(cloud);
    }
  }

  /** Draw cloud shape once — five overlapping ellipses + highlight. Never redrawn. */
  private drawCloud(cloud: Cloud): void {
    const g = cloud.gfx;
    g.clear();

    // Main body
    g.fillStyle(0xeef4ff, 0.88);
    g.fillEllipse(60, 40, 120, 28); // wide flat base
    g.fillEllipse(24, 28,  56, 40); // left puff
    g.fillEllipse(60, 18,  64, 48); // center dome (tallest)
    g.fillEllipse(96, 26,  52, 36); // right puff
    g.fillEllipse(40, 12,  32, 24); // small top-left detail

    // Bright highlight on top
    g.fillStyle(0xffffff, 0.55);
    g.fillEllipse(60, 10, 40, 18);

    g.setScale(cloud.scale);
  }

  private updateClouds(dy: number, scrollY: number): void {
    // Hide clouds when the player is below the cloud-start altitude.
    // scrollY + GAME_HEIGHT is the world Y of the camera bottom edge.
    const inCloudZone = scrollY + GAME_HEIGHT <= CLOUD_START_WORLD_Y;

    for (const cloud of this.clouds) {
      if (!inCloudZone) {
        cloud.gfx.setVisible(false);
        continue;
      }
      cloud.gfx.setVisible(true);

      // When camera moves up (dy < 0, climbing), -dy is positive,
      // so virtualY increases → cloud drifts downward on screen at (1-FACTOR) speed.
      cloud.virtualY += -dy * (1 - CLOUD_PARALLAX_FACTOR);

      // Recycle: drifted below screen bottom
      if (cloud.virtualY > GAME_HEIGHT + 200) {
        cloud.virtualX = Phaser.Math.Between(-60, GAME_WIDTH + 60);
        cloud.virtualY = Phaser.Math.Between(-300, -80);
      }

      // Recycle: drifted above screen top (player fell fast)
      if (cloud.virtualY < -400) {
        cloud.virtualX = Phaser.Math.Between(-60, GAME_WIDTH + 60);
        cloud.virtualY = GAME_HEIGHT + Phaser.Math.Between(20, 200);
      }

      cloud.gfx.setPosition(cloud.virtualX, cloud.virtualY);
    }
  }
}
