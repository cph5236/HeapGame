import type Phaser from 'phaser';
import { logicalWidth, logicalHeight } from '../systems/displayMetrics';
import { addToGameplayUi } from '../systems/GameplayUiCamera';

export type OutroKind = 'death' | 'success';

const TOTAL_DURATION_MS = 3000;
const DRIFT_DURATION_MS = 1800;
const OVERLAY_DEPTH = 1000;

const PROXY_SCALE = 2 / 3;

const SQUISH_T_MS = 1800;
const SHRINK_T_MS = 2000;
const SQUISH_DUR_MS = 80;
const SQUISH_SETTLE_MS = 120;
const SHRINK_DUR_MS = 400;

const TWINKLE_T_MS = 2400;
const TWINKLE_GROW_MS = 150;
const TWINKLE_HOLD_MS = 300;
const TWINKLE_FADE_MS = 150;
const STARBURST_BASE_RADIUS = 50;
const STARBURST_MAX_SCALE = 1.8;

// Texture key for the death outro symbol sprite.
// Preload in BootScene: this.load.image('outro-death', outroDeathUrl)
// Recommended source size: 180×180 px (matches STARBURST_BASE_RADIUS * 2 * STARBURST_MAX_SCALE)
const DEATH_SYMBOL_KEY = 'outro-death';

interface SquishConfig { scaleX: number; scaleY: number }

const SQUISH: Record<OutroKind, SquishConfig> = {
  death:   { scaleX: 1.6,  scaleY: 0.4 },
  success: { scaleX: 0.85, scaleY: 1.3 },
};

interface PaletteConfig {
  fadeColor: number;
  fadeAlphaTo: number;
  gradientColor: number;
}

const PALETTE: Record<OutroKind, PaletteConfig> = {
  death:   { fadeColor: 0x000000, fadeAlphaTo: 1.0, gradientColor: 0xffffff },
  success: { fadeColor: 0x5b8fc9, fadeAlphaTo: 0.8, gradientColor: 0xffd060 },
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

  private starburstGfx: Phaser.GameObjects.Graphics | null = null;
  private starburstScale = 0;
  private starburstAlpha = 1;

  private deathSymbolSprite: Phaser.GameObjects.Sprite | null = null;

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
      .setDepth(OVERLAY_DEPTH + 2)
      .setScale(PROXY_SCALE);

    this.sourceSprite.setVisible(false);

    // Register all three overlay objects to the gameplay UI camera
    addToGameplayUi(this.scene, [this.fadeGfx, this.gradientGfx, this.proxy]);

    // Destination: death → screen center; success → screen top-center
    const w = logicalWidth(this.scene);
    const h = logicalHeight(this.scene);
    const destX = Math.floor(w / 2);
    const destY = Math.floor(h / 2);

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

    // Squish beat at t=1800ms
    const squishTimer = this.scene.time.delayedCall(SQUISH_T_MS, () => this.runSquishBeat(kind));
    this.activeTweens.push({ stop: () => squishTimer.remove() });

    // Shrink beat at t=2000ms
    const shrinkTimer = this.scene.time.delayedCall(SHRINK_T_MS, () => this.runShrinkBeat());
    this.activeTweens.push({ stop: () => shrinkTimer.remove() });

    const twinkleTimer = this.scene.time.delayedCall(TWINKLE_T_MS, () => this.runTwinkleBeat());
    this.activeTweens.push({ stop: () => twinkleTimer.remove() });

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
    if (this.proxy)             { this.proxy.destroy();             this.proxy = null; }
    if (this.fadeGfx)           { this.fadeGfx.destroy();           this.fadeGfx = null; }
    if (this.gradientGfx)       { this.gradientGfx.destroy();       this.gradientGfx = null; }
    if (this.starburstGfx)      { this.starburstGfx.destroy();      this.starburstGfx = null; }
    if (this.deathSymbolSprite) { this.deathSymbolSprite.destroy(); this.deathSymbolSprite = null; }
  }

  private runSquishBeat(kind: OutroKind): void {
    if (!this.proxy || this.completed) return;
    const s = SQUISH[kind];
    const squashTween = this.scene.tweens.add({
      targets: this.proxy,
      scaleX: { from: PROXY_SCALE, to: s.scaleX },
      scaleY: { from: PROXY_SCALE, to: s.scaleY },
      duration: SQUISH_DUR_MS,
      ease: 'Linear.none',
      onComplete: () => {
        if (!this.proxy || this.completed) return;
        const settleTween = this.scene.tweens.add({
          targets: this.proxy,
          scaleX: { from: s.scaleX, to: PROXY_SCALE },
          scaleY: { from: s.scaleY, to: PROXY_SCALE },
          duration: SQUISH_SETTLE_MS,
          ease: 'Quad.easeInOut',
        });
        this.activeTweens.push(settleTween as unknown as { stop: () => void });
      },
    });
    this.activeTweens.push(squashTween as unknown as { stop: () => void });
  }

  private runShrinkBeat(): void {
    if (!this.proxy || this.completed) return;
    const shrinkTween = this.scene.tweens.add({
      targets: this.proxy,
      scaleX: { from: PROXY_SCALE, to: 0 },
      scaleY: { from: PROXY_SCALE, to: 0 },
      duration: SHRINK_DUR_MS,
      ease: 'Cubic.easeIn',
    });
    this.activeTweens.push(shrinkTween as unknown as { stop: () => void });
  }

  private runTwinkleBeat(): void {
    if (this.completed || !this.proxy) return;
    const cx = this.proxy.x;
    const cy = this.proxy.y;

    if (this.kind === 'death') {
      const targetSize = STARBURST_BASE_RADIUS * 2 * STARBURST_MAX_SCALE;
      this.deathSymbolSprite = this.scene.add.sprite(cx, cy, DEATH_SYMBOL_KEY)
        .setScrollFactor(0)
        .setDepth(OVERLAY_DEPTH + 3)
        .setDisplaySize(targetSize, targetSize);
      const targetScale = (this.deathSymbolSprite as unknown as { scaleX: number }).scaleX;
      this.deathSymbolSprite.setScale(0);

      addToGameplayUi(this.scene, this.deathSymbolSprite);

      const growTween = this.scene.tweens.add({
        targets: this.deathSymbolSprite,
        scaleX: targetScale,
        scaleY: targetScale,
        duration: TWINKLE_GROW_MS,
        ease: 'Back.easeOut',
        onComplete: () => {
          if (this.completed) return;
          const holdTimer = this.scene.time.delayedCall(TWINKLE_HOLD_MS, () => {
            if (this.completed) return;
            const fadeTween = this.scene.tweens.add({
              targets: this.deathSymbolSprite,
              alpha: 0,
              duration: TWINKLE_FADE_MS,
              ease: 'Linear',
            });
            this.activeTweens.push(fadeTween as unknown as { stop: () => void });
          });
          this.activeTweens.push({ stop: () => holdTimer.remove() });
        },
      });
      this.activeTweens.push(growTween as unknown as { stop: () => void });
    } else {
      this.starburstGfx = this.scene.add.graphics()
        .setScrollFactor(0)
        .setDepth(OVERLAY_DEPTH + 3);
      this.starburstScale = 0;
      this.starburstAlpha = 1;

      addToGameplayUi(this.scene, this.starburstGfx);

      const growTween = this.scene.tweens.add({
        targets: this,
        starburstScale: { from: 0, to: STARBURST_MAX_SCALE },
        duration: TWINKLE_GROW_MS,
        ease: 'Back.easeOut',
        onComplete: () => {
          if (this.completed) return;
          const holdTimer = this.scene.time.delayedCall(TWINKLE_HOLD_MS, () => {
            if (this.completed) return;
            const fadeTween = this.scene.tweens.add({
              targets: this,
              starburstAlpha: { from: 1, to: 0 },
              duration: TWINKLE_FADE_MS,
              ease: 'Linear',
            });
            this.activeTweens.push(fadeTween as unknown as { stop: () => void });
          });
          this.activeTweens.push({ stop: () => holdTimer.remove() });
        },
      });
      this.activeTweens.push(growTween as unknown as { stop: () => void });
    }
  }

  private redrawOverlay(): void {
    if (!this.fadeGfx || !this.gradientGfx || !this.proxy) return;
    const palette = PALETTE[this.kind];
    const w = logicalWidth(this.scene);
    const h = logicalHeight(this.scene);

    // fillCircle covers every corner (radius > half-diagonal). fillRect(0,0,w,h) doesn't
    // render in Phaser 3.90 Canvas mode on a scrollFactor=0 Graphics at world origin.
    this.fadeGfx.clear();
    if (this.fadeAlpha > 0) {
      this.fadeGfx.fillStyle(palette.fadeColor, this.fadeAlpha);
      this.fadeGfx.fillCircle(w / 2, h / 2, Math.max(w, h));
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

    if (this.starburstGfx && this.proxy && this.starburstScale > 0) {
      this.starburstGfx.clear();
      const r = STARBURST_BASE_RADIUS * this.starburstScale;
      const cx = this.proxy.x;
      const cy = this.proxy.y;
      this.drawStar(cx, cy, r);
    }
  }

  private drawStar(cx: number, cy: number, r: number): void {
    const g = this.starburstGfx!;
    const a = this.starburstAlpha;
    const color = PALETTE[this.kind].gradientColor;

    // Outer 4-pointed star — clean perimeter outline, no inner crossings
    const outer = PlayerOutro.starPolygon(cx, cy, r, r * 0.28, 4, -Math.PI / 2);
    g.fillStyle(color, a);
    g.fillPoints(outer, true);
    g.lineStyle(1.5, 0x000000, a);
    g.strokePoints(outer, true);

    // Centre jewel — filled circle with outline, sits inside the star
    g.fillStyle(0xffe8a0, a);
    g.fillCircle(cx, cy, r * 0.2);
    g.lineStyle(1.5, 0x000000, a);
    g.strokeCircle(cx, cy, r * 0.2);
  }

  private static starPolygon(
    cx: number, cy: number,
    outerR: number, innerR: number,
    numPoints: number, angleOffset: number,
  ): { x: number; y: number }[] {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < numPoints * 2; i++) {
      const rad = i % 2 === 0 ? outerR : innerR;
      const a   = (i * Math.PI / numPoints) + angleOffset;
      pts.push({ x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a) });
    }
    return pts;
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
