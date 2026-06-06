import Phaser from 'phaser';
import { InputManager } from './InputManager';
import { JoystickController } from './JoystickController';
import { Player } from '../entities/Player';
import { getControlMode, getJoystickSide } from './SaveData';
import { JOYSTICK_RADIUS, JOYSTICK_MARGIN, DASH_BUTTON_RADIUS } from '../constants';

export interface JoystickHandle {
  update(delta: number): void;
  destroy(): void;
}

const DASH_SUPPRESS_ID = 'dash';

/** When controlMode === 'joystick', build the stick + dash button for `scene`.
 *  The stick sits in one bottom corner (per joystickSide); the dash button in the
 *  opposite corner. Returns null in tilt mode. Caller updates BEFORE im.update()
 *  and calls destroy() on scene shutdown. */
export function mountJoystick(
  scene: Phaser.Scene, im: InputManager, player: Player,
): JoystickHandle | null {
  if (getControlMode() !== 'joystick') return null;

  const side = getJoystickSide();
  const w = scene.scale.width;
  const h = scene.scale.height;

  const stickX = side === 'left'
    ? JOYSTICK_MARGIN + JOYSTICK_RADIUS
    : w - JOYSTICK_MARGIN - JOYSTICK_RADIUS;
  const stickY = h - JOYSTICK_MARGIN - JOYSTICK_RADIUS;
  const controller = new JoystickController(scene, stickX, stickY);

  // Dash button: opposite bottom corner from the stick.
  const dashX = side === 'left'
    ? w - JOYSTICK_MARGIN - DASH_BUTTON_RADIUS
    : JOYSTICK_MARGIN + DASH_BUTTON_RADIUS;
  const dashY = h - JOYSTICK_MARGIN - DASH_BUTTON_RADIUS;

  const dashBtn = scene.add.circle(dashX, dashY, DASH_BUTTON_RADIUS, 0x331a1a, 0.55)
    .setStrokeStyle(2, 0xff7755).setScrollFactor(0).setDepth(40)
    .setVisible(player.hasDash);
  const dashLabel = scene.add.text(dashX, dashY, '»', {
    fontSize: '26px', color: '#ffbbaa', fontStyle: 'bold',
  }).setOrigin(0.5).setScrollFactor(0).setDepth(41).setVisible(player.hasDash);

  if (player.hasDash) {
    dashBtn.setInteractive({ useHandCursor: true });
    dashBtn.on('pointerdown', () => {
      const dir: 1 | -1 = im.tiltFactor > 0.05 ? 1
        : im.tiltFactor < -0.05 ? -1
        : (player.sprite.flipX ? -1 : 1);
      im.pulseDash(dir);
    });
    // Suppress so the tap never leaks into a gesture (belt-and-suspenders).
    im.setSuppressionRect(DASH_SUPPRESS_ID, {
      x: dashX - DASH_BUTTON_RADIUS, y: dashY - DASH_BUTTON_RADIUS,
      w: DASH_BUTTON_RADIUS * 2, h: DASH_BUTTON_RADIUS * 2,
    });
  }

  return {
    update: (delta: number) => controller.update(delta),
    destroy: () => {
      controller.destroy();
      dashBtn.destroy();
      dashLabel.destroy();
      im.setSuppressionRect(DASH_SUPPRESS_ID, null);
    },
  };
}
