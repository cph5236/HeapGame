import type Phaser from 'phaser';

export type OutroKind = 'death' | 'success';

const TOTAL_DURATION_MS = 2500;
const DRIFT_DURATION_MS = 1800;
const OVERLAY_DEPTH = 1000;

interface PaletteConfig {
  fadeColor: number;
  fadeAlphaTo: number;
  gradientColor: number;
}

const PALETTE: Record<OutroKind, PaletteConfig> = {
  death:   { fadeColor: 0x000000, fadeAlphaTo: 1.0, gradientColor: 0xffffff },
  success: { fadeColor: 0xffaa33, fadeAlphaTo: 0.6, gradientColor: 0xffd060 },
};

export class PlayerOutro {
  private readonly scene: Phaser.Scene;
  private readonly sourceSprite: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;

  private playing = false;
  private completed = false;
  private onComplete: (() => void) | null = null;
  private kind: OutroKind = 'death';

  private finalTimer: Phaser.Time.TimerEvent | null = null;
  private activeTweens: Array<{ stop: () => void }> = [];
  private tapHandler: ((...args: unknown[]) => void) | null = null;
  private updateHandler: (() => void) | null = null;

  private proxy: Phaser.GameObjects.Sprite | null = null;
  private fadeGfx: Phaser.GameObjects.Graphics | null = null;
  private gradientGfx: Phaser.GameObjects.Graphics | null = null;
  private fadeAlpha = 0;
  private gradientRadius = 0;

  constructor(
    scene: Phaser.Scene,
    sourceSprite: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody,
  ) {
    this.scene = scene;
    this.sourceSprite = sourceSprite;
  }

  play(kind: OutroKind, onComplete: () => void): void {
    if (this.playing) throw new Error('PlayerOutro: play() called while already playing');
    this.playing = true;
    this.completed = false;
    this.kind = kind;
    this.onComplete = onComplete;

    this.scene.physics.world.pause();

    const cam = this.scene.cameras.main;
    const screenX = this.sourceSprite.x - cam.scrollX;
    const screenY = this.sourceSprite.y - cam.scrollY;

    // Background fade graphics (depth: below gradient + proxy)
    this.fadeGfx = this.scene.add.graphics()
      .setScrollFactor(0)
      .setDepth(OVERLAY_DEPTH);
    this.fadeAlpha = 0;

    // Radial gradient graphics (depth: above fade, below proxy)
    this.gradientGfx = this.scene.add.graphics()
      .setScrollFactor(0)
      .setDepth(OVERLAY_DEPTH + 1);
    this.gradientRadius = 0;

    // Proxy sprite
    const textureKey = (this.sourceSprite as unknown as { texture: { key: string } }).texture.key;
    this.proxy = this.scene.add.sprite(screenX, screenY, textureKey)
      .setScrollFactor(0)
      .setDepth(OVERLAY_DEPTH + 2);

    this.sourceSprite.setVisible(false);

    // Destination: death → screen center; success → screen top-center
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;
    const destX = Math.floor(w / 2);
    const destY = kind === 'death' ? Math.floor(h / 2) : Math.floor(h * 0.15);

    const driftTween = this.scene.tweens.add({
      targets: this.proxy,
      x: { from: screenX, to: destX },
      y: { from: screenY, to: destY },
      duration: DRIFT_DURATION_MS,
      ease: 'Cubic.easeOut',
    });
    this.activeTweens.push(driftTween as unknown as { stop: () => void });

    this.tapHandler = () => this.skip();
    this.scene.input.on('pointerdown', this.tapHandler);

    this.updateHandler = () => this.redrawOverlay();
    this.scene.events.on('update', this.updateHandler);

    const palette = PALETTE[kind];

    // Fade tween: fadeAlpha 0 → palette.fadeAlphaTo over 1800ms
    const fadeTween = this.scene.tweens.add({
      targets: this,
      fadeAlpha: { from: 0, to: palette.fadeAlphaTo },
      duration: DRIFT_DURATION_MS,
      ease: 'Cubic.easeOut',
    });
    this.activeTweens.push(fadeTween as unknown as { stop: () => void });

    // Gradient grow tween: radius 0 → 160 over 1800ms
    const gradientTween = this.scene.tweens.add({
      targets: this,
      gradientRadius: { from: 0, to: 160 },
      duration: DRIFT_DURATION_MS,
      ease: 'Cubic.easeOut',
    });
    this.activeTweens.push(gradientTween as unknown as { stop: () => void });

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
    if (this.updateHandler) this.scene.events.off('update', this.updateHandler);
    this.updateHandler = null;
    if (this.proxy)       { this.proxy.destroy();       this.proxy = null; }
    if (this.fadeGfx)     { this.fadeGfx.destroy();     this.fadeGfx = null; }
    if (this.gradientGfx) { this.gradientGfx.destroy(); this.gradientGfx = null; }
  }

  private redrawOverlay(): void {
    if (!this.fadeGfx || !this.gradientGfx || !this.proxy) return;
    const palette = PALETTE[this.kind];
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;

    // Fade: solid rect over the whole screen, with current alpha
    this.fadeGfx.clear();
    if (this.fadeAlpha > 0) {
      this.fadeGfx.fillStyle(palette.fadeColor, this.fadeAlpha);
      this.fadeGfx.fillRect(0, 0, w, h);
    }

    // Gradient: approximate radial gradient with concentric circles at decreasing alpha
    this.gradientGfx.clear();
    if (this.gradientRadius > 0) {
      const steps = 10;
      for (let i = steps; i >= 1; i--) {
        const r = (this.gradientRadius * i) / steps;
        const alpha = (1 - (i - 1) / steps) * 0.6;
        this.gradientGfx.fillStyle(palette.gradientColor, alpha);
        this.gradientGfx.fillCircle(this.proxy.x, this.proxy.y, r);
      }
    }
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
