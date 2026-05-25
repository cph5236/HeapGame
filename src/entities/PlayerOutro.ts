import type Phaser from 'phaser';

export type OutroKind = 'death' | 'success';

const TOTAL_DURATION_MS = 2500;

/**
 * Cinematic transition that lifts the player off the world onto a screen-space
 * overlay, runs a 4-beat sequence (drift → squish → shrink → twinkle), and
 * fires onComplete. Tap anywhere hard-cuts to onComplete.
 */
export class PlayerOutro {
  private readonly scene: Phaser.Scene;
  // @ts-expect-error used by future animation tasks
  private readonly sourceSprite: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;

  private playing = false;
  private completed = false;
  private onComplete: (() => void) | null = null;

  private finalTimer: Phaser.Time.TimerEvent | null = null;
  private activeTweens: Array<{ stop: () => void }> = [];
  private tapHandler: ((...args: unknown[]) => void) | null = null;

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
    this.activeTweens.forEach(t => t.stop());
    this.activeTweens = [];
    if (this.tapHandler) this.scene.input.off('pointerdown', this.tapHandler);
    this.tapHandler = null;
    this.scene.events.off('shutdown');  // no-op safety
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
