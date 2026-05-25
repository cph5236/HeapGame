import type Phaser from 'phaser';

export type OutroKind = 'death' | 'success';

const TOTAL_DURATION_MS = 2500;
const OVERLAY_DEPTH = 1000;

export class PlayerOutro {
  private readonly scene: Phaser.Scene;
  private readonly sourceSprite: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;

  private playing = false;
  private completed = false;
  private onComplete: (() => void) | null = null;

  private finalTimer: Phaser.Time.TimerEvent | null = null;
  private activeTweens: Array<{ stop: () => void }> = [];
  private tapHandler: ((...args: unknown[]) => void) | null = null;

  private proxy: Phaser.GameObjects.Sprite | null = null;

  constructor(
    scene: Phaser.Scene,
    sourceSprite: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody,
  ) {
    this.scene = scene;
    this.sourceSprite = sourceSprite;
  }

  play(_kind: OutroKind, onComplete: () => void): void {
    if (this.playing) throw new Error('PlayerOutro: play() called while already playing');
    this.playing = true;
    this.completed = false;
    this.onComplete = onComplete;

    this.scene.physics.world.pause();

    const cam = this.scene.cameras.main;
    const screenX = this.sourceSprite.x - cam.scrollX;
    const screenY = this.sourceSprite.y - cam.scrollY;

    const textureKey = (this.sourceSprite as unknown as { texture: { key: string } }).texture.key;
    this.proxy = this.scene.add.sprite(screenX, screenY, textureKey)
      .setScrollFactor(0)
      .setDepth(OVERLAY_DEPTH + 2);

    this.sourceSprite.setVisible(false);

    this.tapHandler = () => this.skip();
    this.scene.input.on('pointerdown', this.tapHandler);

    this.finalTimer = this.scene.time.delayedCall(TOTAL_DURATION_MS, () => this.finish());
  }

  skip(): void {
    if (!this.playing || this.completed) return;
    this.finish();
  }

  destroy(): void {
    if (this.finalTimer) this.finalTimer.remove();
    this.finalTimer = null;
    this.activeTweens.forEach(t => t.stop());
    this.activeTweens = [];
    if (this.tapHandler) this.scene.input.off('pointerdown', this.tapHandler);
    this.tapHandler = null;
    if (this.proxy) { this.proxy.destroy(); this.proxy = null; }
  }

  private finish(): void {
    if (this.completed) return;
    this.completed = true;
    this.playing = false;
    const cb = this.onComplete;
    this.onComplete = null;
    this.destroy();
    cb?.();
  }
}
