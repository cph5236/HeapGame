import Phaser from 'phaser';
// Single-plugin import — tree-shaken, not the whole rex bundle.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plugin ships JS; we type it structurally below.
import VirtualJoystick from 'phaser3-rex-plugins/plugins/virtualjoystick.js';
import { InputManager } from './InputManager';
import {
  axisFromForce, zoneFromAxis, initDoubleTap, stepDoubleTap,
} from './joystickMath';
import type { DoubleTapState } from './joystickMath';
import {
  JOYSTICK_RADIUS, JOYSTICK_DEAD_ZONE, JOYSTICK_CURVE_EXP,
  JOYSTICK_TAP_THRESHOLD, JOYSTICK_DOUBLETAP_MS, JOYSTICK_FORCE_MIN_FRAC,
} from '../constants';

/** The subset of rex VirtualJoystick we use. */
interface RexJoystick {
  forceX: number;
  up: boolean;
  down: boolean;
  enable: boolean;
  setPosition(x: number, y: number): RexJoystick;
  setVisible(v: boolean): RexJoystick;
  destroy(): void;
}

export class JoystickController {
  private joy: RexJoystick;
  private base: Phaser.GameObjects.Arc;
  private thumb: Phaser.GameObjects.Arc;
  private im = InputManager.getInstance();

  private prevDown = false;
  private dt: DoubleTapState = initDoubleTap();

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.base = scene.add.circle(x, y, JOYSTICK_RADIUS, 0x000000, 0.45)
      .setStrokeStyle(2, 0x8899bb).setScrollFactor(0).setDepth(40);
    this.thumb = scene.add.circle(x, y, JOYSTICK_RADIUS * 0.42, 0x6688ff, 0.9)
      .setScrollFactor(0).setDepth(41);

    this.joy = new VirtualJoystick(scene, {
      x, y,
      radius: JOYSTICK_RADIUS,
      base: this.base,
      thumb: this.thumb,
      dir: '8dir',
      fixed: true,
      forceMin: JOYSTICK_RADIUS * JOYSTICK_FORCE_MIN_FRAC,
      enable: true,
    }) as unknown as RexJoystick;
  }

  /** Read rex state and write InputManager. Call BEFORE im.update() each frame. */
  update(_delta: number): void {
    const axis = axisFromForce(
      this.joy.forceX, JOYSTICK_RADIUS, JOYSTICK_DEAD_ZONE, JOYSTICK_CURVE_EXP,
    );
    this.im.setAxis(axis);

    const up = this.joy.up;
    const down = this.joy.down;

    // Jump is intentionally NOT on the stick — it stays on tap/swipe gestures,
    // which feel better for repeated jumping. Stick-up only drives ladder climb.
    // Dive: rising edge of down (burst); held down sustains via diveHeld.
    if (down && !this.prevDown) this.im.pulseDive();
    this.im.diveHeld = down;

    // Ladder climb signals (continuous): up climbs, down descends.
    this.im.setLadderDrag(up, down);

    // Dash: double-tap a horizontal direction.
    const zone = zoneFromAxis(axis, JOYSTICK_TAP_THRESHOLD);
    const r = stepDoubleTap(this.dt, zone, performance.now(), JOYSTICK_DOUBLETAP_MS);
    if (r.fired) this.im.pulseDash(r.dir);
    this.prevDown = down;
  }

  setVisible(v: boolean): void {
    this.base.setVisible(v);
    this.thumb.setVisible(v);
    this.joy.enable = v;
  }

  destroy(): void {
    this.joy.destroy();   // detaches rex pointer handlers
    this.base.destroy();
    this.thumb.destroy();
    this.im.diveHeld = false;
    this.im.setLadderDrag(false, false);
  }
}
